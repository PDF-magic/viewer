import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/viewer/enhance-pdf.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");
const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");

async function enhancerFixture(sendNativeMessage, pageNumber = "1", data = new Uint8Array([37, 80, 68, 70, 45]), sourceUrl = "https://example.com/source.pdf", documentOverrides = {}, setupOptions = {}) {
  const elements = new Map();
  const clickHandlers = new Map();
  for (const id of ["enhance-nav", "enhance-pdf", "section-enhance-pdf", "section-popover", "section-toggle", "install-enhancer", "section-nav", "page-number", "toast", "enhance-progress", "enhance-progress-bar", "enhance-progress-label", "enhance-progress-percentage", "enhancer-setup-dialog", "enhancer-setup-form", "enhancer-setup-close", "enhancer-repository-url", "enhancer-checkout-path", "enhancer-setup-status", "open-enhancer-setup", "tools-menu", "tools-button", "enhance-error-notice", "enhance-error-message", "enhance-copy-error", "enhance-dismiss-error", "enhancer-model-popover", "enhancer-model-form", "enhancer-extract-model", "enhancer-review-model", "enhancer-model-status", "enhancer-model-start", "enhancer-model-refresh", "enhancer-model-download", "enhancer-model-name", "enhancer-model-close"]) {
    elements.set(`#${id}`, {
      hidden: id !== "enhance-pdf",
      title: "Enhance PDF",
      value: id === "page-number" ? "1" : "",
      setAttribute() {},
      removeAttribute() {},
      addEventListener(type, handler) { if (type === "click") clickHandlers.set(id, handler); if (type === "submit") clickHandlers.set(id + ":submit", handler); },
      showModal() { this.open = true; },
      showPopover() { this.open = true; },
      hidePopover() { this.open = false; },
      getBoundingClientRect() { return { left: 20, bottom: 40 }; },
      replaceChildren(...children) { this.options = children; },
      close() { this.open = false; },
      classList: { add() {}, remove() {} },
      style: { setProperty() {} },
    });
  }
  for (const id of ["enhance-save-notice", "enhance-save-message", "enhance-save-copy"]) {
    elements.set(`#${id}`, {
      hidden: true,
      focus() {},
      addEventListener(type, handler) { if (type === "click") clickHandlers.set(id, handler); },
    });
  }
  elements.get("#page-number").value = pageNumber;
  const destinations = [];
  const messages = [];
  const progressSnapshots = [];
  const setupPrompts = [];
  const clipboardWrites = [];
  const setupDownloads = [];
  let messageListener;
  let disconnectListener;
  const runtime = {
    id: "abcdefghijklmnopabcdefghijklmnop",
    getURL: (path) => `chrome-extension://viewer/${path}`,
    sendNativeMessage,
    connectNative: () => ({
      onMessage: { addListener(listener) { messageListener = listener; } },
      onDisconnect: { addListener(listener) { disconnectListener = listener; } },
      postMessage(message) {
        messages.push(message);
        Promise.resolve().then(async () => {
          try {
            if (message.action === "list-ollama-models") {
              messageListener({ ok: true, models: ["deepseek-ocr:latest", "sec-ocr-review:latest", "other:latest"],
                defaultExtractModel: "deepseek-ocr:latest", defaultReviewModel: "sec-ocr-review:latest" });
            } else if (["enhance-pdf", "enhance-pdf-finish"].includes(message.action)) {
              const response = await sendNativeMessage(message);
              if (response.ok) {
                messageListener({ type: "progress", stage: "review", completed: 2, total: 4 });
                progressSnapshots.push({ label: elements.get("#enhance-progress-label").textContent,
                  value: elements.get("#enhance-progress-bar").value,
                  percentage: elements.get("#enhance-progress-percentage").textContent,
                  hidden: elements.get("#enhance-progress").hidden });
              }
              messageListener(response);
            } else {
              messageListener({ ok: true });
            }
          } catch (error) {
            runtime.lastError = error;
            disconnectListener();
          }
        });
      },
      disconnect() {},
    }),
  };
  const context = vm.createContext({
    document: { querySelector: (selector) => elements.get(selector), documentElement: { classList: { add() {}, remove() {} } } },
    MutationObserver: class { observe() {} },
    downloadSetupZip: (options) => setupDownloads.push(options),
    setTimeout() {}, clearTimeout() {}, URL,
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    btoa: (binary) => Buffer.from(binary, "binary").toString("base64"),
    pdfDocumentSessionReady: Promise.resolve({ document: { getData: async () => data, ...documentOverrides } }),
    window: {
      innerWidth: 1000,
      location: { href: "chrome-extension://viewer/src/viewer.html?url=https%3A%2F%2Fexample.com%2Fsource.pdf#page=9" },
      confirm: (message) => {
        setupPrompts.push(message);
        return setupOptions.approveSetup ?? true;
      },
    },
    navigator: {
      clipboard: {
        writeText: async (value) => {
          if (setupOptions.clipboardError) throw setupOptions.clipboardError;
          clipboardWrites.push(value);
        },
      },
    },
    resolvePdfSource: async () => ({ originalUrl: new URL(sourceUrl) }),
    resolveDocumentReferenceUrl: async () => "https://example.com/source.pdf",
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime,
      downloads: setupOptions.downloads,
      tabs: { getCurrent: async () => ({ id: 42 }), update: async (_, destination) => destinations.push(destination.url) },
    },
  });
  vm.runInContext(source, context);
  await vm.runInContext("enhanceCurrentPdf()", context);
  return { elements, clickHandlers, destinations, messages, progressSnapshots, setupPrompts, clipboardWrites, setupDownloads };
}

test("Enhance appears at the bottom of the sections menu and uses the same action", async () => {
  const sectionMarkup = markup.slice(markup.indexOf('id="section-popover"'), markup.indexOf('id="previous-page"'));
  assert.ok(sectionMarkup.indexOf('id="section-enhance-pdf"') > sectionMarkup.indexOf('id="section-metadata"'));

  const { elements, clickHandlers, destinations, messages } = await enhancerFixture(
    async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }),
  );
  elements.get("#section-popover").hidden = false;
  await clickHandlers.get("section-enhance-pdf")();
  assert.equal(elements.get("#section-popover").hidden, true);
  assert.equal(elements.get("#enhancer-model-popover").open, true);
  assert.equal(destinations.length, 1);
  assert.equal(elements.get("#enhancer-extract-model").value, "deepseek-ocr:latest");
  assert.equal(elements.get("#enhancer-review-model").value, "sec-ocr-review:latest");
  elements.get("#enhancer-review-model").value = "other:latest";
  await clickHandlers.get("enhancer-model-form:submit")({ preventDefault() {} });
  assert.equal(elements.get("#enhancer-model-popover").open, false);
  assert.equal(destinations.length, 2);
  const start = messages.filter(message => message.action === "enhance-pdf-start").at(-1);
  assert.equal(start.extractModel, "deepseek-ocr:latest");
  assert.equal(start.reviewModel, "other:latest");
  assert.equal(elements.get("#section-enhance-pdf").disabled, false);
});

test("missing native host opens the user-controlled setup dialog instead of executing commands", async () => {
  const { elements, setupPrompts, clipboardWrites } = await enhancerFixture(async () => {
    throw new Error("Specified native messaging host not found.");
  });
  assert.equal(elements.get("#enhancer-setup-dialog").open, true);
  assert.equal(elements.get("#enhancer-repository-url").value, "https://github.com/PDF-magic/enhancer");
  assert.deepEqual(setupPrompts, [], "Setup never uses the old browser confirmation prompt");
  assert.deepEqual(clipboardWrites, [], "No shell commands are silently copied");
  assert.equal(elements.get("#enhance-pdf").disabled, false);
});

test("enhancer setup submits a ZIP request only after explicit form submission", async () => {
  const { elements, clickHandlers, setupDownloads } = await enhancerFixture(async () => {
    throw new Error("Specified native messaging host not found.");
  });
  assert.deepEqual(setupDownloads, []);
  elements.get("#enhancer-repository-url").value = "https://github.com/example/enhancer";
  elements.get("#enhancer-checkout-path").value = "/tmp/my-enhancer";
  let prevented = false;
  await clickHandlers.get("enhancer-setup-form:submit")({
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.deepEqual(setupDownloads.map((option) => ({ ...option })), [{
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    repositoryUrl: "https://github.com/example/enhancer",
    checkoutPath: "/tmp/my-enhancer",
  }]);
});

test("enhancement errors keep the enhance action available", async () => {
  const { elements } = await enhancerFixture(async () => ({ ok: false, error: "OCR failed" }));
  assert.equal(elements.get("#enhance-pdf").hidden, false);
  assert.equal(elements.get("#install-enhancer").hidden, true);
  assert.equal(elements.get("#enhance-pdf").disabled, false);
});

test("successful enhancement opens the returned local PDF directly in the viewer", async () => {
  const { destinations } = await enhancerFixture(async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }));
  assert.deepEqual(destinations, ["chrome-extension://viewer/src/viewer.html?url=file%3A%2F%2F%2Ftmp%2Fenhanced.pdf"]);
});

test("enhancement preserves the current page in the viewer destination", async () => {
  const { destinations } = await enhancerFixture(async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }), "55");
  assert.deepEqual(destinations, ["chrome-extension://viewer/src/viewer.html?url=file%3A%2F%2F%2Ftmp%2Fenhanced.pdf#page=55"]);
});

test("remote enhancement sends loaded PDF bytes in bounded chunks", async () => {
  const data = new Uint8Array(600_000);
  for (let index = 0; index < data.length; index++) data[index] = index % 256;
  const { messages } = await enhancerFixture(async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }), "1", data);
  assert.equal(messages[0].action, "enhance-pdf-start");
  assert.equal(messages[0].sourceUrl, "https://example.com/source.pdf");
  assert.equal(messages[0].referenceUrl, "https://example.com/source.pdf");
  assert.equal(messages[0].byteLength, data.length);
  const chunks = messages.filter((message) => message.action === "enhance-pdf-chunk");
  assert.equal(chunks.length, 3);
  const decoded = chunks.map((chunk) => Buffer.from(chunk.data, "base64"));
  assert.ok(decoded.every((chunk) => chunk.length <= 256 * 1024));
  assert.deepEqual(Buffer.concat(decoded), Buffer.from(data));
  assert.equal(messages.at(-1).action, "enhance-pdf-finish");
});

test("modern word-processor PDFs use the light enhancement path", async () => {
  const text = "A clean born-digital paragraph with enough embedded text to preserve directly.";
  const { messages } = await enhancerFixture(
    async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }),
    "1",
    new Uint8Array([37, 80, 68, 70, 45]),
    "https://example.com/source.pdf",
    {
      numPages: 3,
      getMetadata: async () => ({ info: { Creator: "Microsoft Word for Microsoft 365" } }),
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: text }] }) }),
    },
  );
  assert.equal(messages[0].enhancementMode, "light");
});

test("OCR text layers use the text-preserving enhancement path", async () => {
  const { messages } = await enhancerFixture(
    async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }),
    "1",
    new Uint8Array([37, 80, 68, 70, 45]),
    "https://example.com/source.pdf",
    {
      numPages: 3,
      getMetadata: async () => ({ info: { Creator: "Adobe Acrobat" } }),
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "OCR text ".repeat(100) }] }) }),
    },
  );
  assert.equal(messages[0].enhancementMode, "light");
});

test("progress events update the bar without consuming the final response", async () => {
  const { progressSnapshots, elements, destinations } = await enhancerFixture(async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }));
  assert.deepEqual(progressSnapshots, [{ label: "Enhancing · 2 of 4 pages", value: 50, percentage: "50%", hidden: false }]);
  assert.equal(destinations.length, 1);
  assert.equal(elements.get("#enhance-progress").hidden, true);
});

test("local PDFs use a persistent native connection for progress", async () => {
  const { messages, progressSnapshots, destinations } = await enhancerFixture(async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }), "1", undefined, "file:///tmp/source.pdf");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, "enhance-pdf");
  assert.equal(messages[0].progress, true);
  assert.equal(messages[0].enhancementMode, "light");
  assert.equal(progressSnapshots[0].value, 50);
  assert.deepEqual(destinations, ["chrome-extension://viewer/src/viewer.html?url=file%3A%2F%2F%2Ftmp%2Fenhanced.pdf"]);
});

test("a denied local path retries with the loaded PDF and opens the copy saved beside it", async () => {
  const sourceUrl = "file:///Users/example/Desktop/local%20source.pdf";
  const data = new Uint8Array([37, 80, 68, 70, 45]);
  const downloads = [];
  const listeners = new Set();
  const { messages, elements, clickHandlers, destinations } = await enhancerFixture(async ({ action }) => {
    if (action === "enhance-pdf") {
      return { ok: false, error: "[Errno 1] Operation not permitted: '/Users/example/Desktop/local source.pdf'" };
    }
    return { ok: true, outputUrl: "file:///tmp/enhanced.pdf" };
  }, "2", data, sourceUrl, {}, {
    downloads: {
      download: async (options) => downloads.push({ ...options }),
      search: async ({ id }) => id === 1
        ? [{ state: "interrupted", error: "USER_CANCELED" }]
        : [{ state: "complete", filename: "/Users/example/Desktop/enhanced #1.pdf" }],
      onChanged: { addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener) },
    },
  });

  assert.deepEqual(messages.map(({ action }) => action), [
    "enhance-pdf", "enhance-pdf-start", "enhance-pdf-chunk", "enhance-pdf-finish",
  ]);
  assert.equal(messages[1].sourceUrl, sourceUrl);
  assert.equal(messages[1].referenceUrl, messages[0].referenceUrl);
  assert.equal(messages[1].byteLength, data.length);
  assert.deepEqual(Buffer.from(messages[2].data, "base64"), Buffer.from(data));
  assert.match(elements.get("#enhance-save-message").textContent, /\/Users\/example\/Desktop\//);
  assert.equal(elements.get("#enhance-save-notice").hidden, false);
  assert.deepEqual(destinations, []);
  await clickHandlers.get("enhance-save-copy")();
  assert.deepEqual(destinations, []);
  assert.equal(elements.get("#enhance-save-notice").hidden, false);
  await clickHandlers.get("enhance-save-copy")();
  assert.deepEqual(downloads[1], { url: "file:///tmp/enhanced.pdf", filename: "enhanced.pdf", saveAs: true });
  assert.deepEqual(destinations, ["chrome-extension://viewer/src/viewer.html?url=file%3A%2F%2F%2FUsers%2Fexample%2FDesktop%2Fenhanced%2520%25231.pdf#page=2"]);
  assert.equal(elements.get("#enhance-save-notice").hidden, true);
  assert.equal(listeners.size, 0);
});
