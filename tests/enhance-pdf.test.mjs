import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/viewer/enhance-pdf.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");
const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");

async function enhancerFixture(sendNativeMessage, pageNumber = "1", data = new Uint8Array([37, 80, 68, 70, 45]), sourceUrl = "https://example.com/source.pdf", documentOverrides = {}) {
  const elements = new Map();
  for (const id of ["enhance-nav", "enhance-pdf", "install-enhancer", "section-nav", "page-number", "toast", "enhance-progress", "enhance-progress-bar", "enhance-progress-label", "enhance-progress-percentage"]) {
    elements.set(`#${id}`, {
      hidden: id !== "enhance-pdf",
      title: "Enhance PDF",
      value: "1",
      setAttribute() {},
      removeAttribute() {},
      addEventListener() {},
      classList: { add() {}, remove() {} },
      style: { setProperty() {} },
    });
  }
  elements.get("#page-number").value = pageNumber;
  const destinations = [];
  const messages = [];
  const progressSnapshots = [];
  let messageListener;
  let disconnectListener;
  const runtime = {
    sendNativeMessage,
    connectNative: () => ({
      onMessage: { addListener(listener) { messageListener = listener; } },
      onDisconnect: { addListener(listener) { disconnectListener = listener; } },
      postMessage(message) {
        messages.push(message);
        Promise.resolve().then(async () => {
          try {
            if (["enhance-pdf", "enhance-pdf-finish"].includes(message.action)) {
              messageListener({ type: "progress", stage: "review", completed: 2, total: 4 });
              progressSnapshots.push({ label: elements.get("#enhance-progress-label").textContent,
                value: elements.get("#enhance-progress-bar").value,
                percentage: elements.get("#enhance-progress-percentage").textContent,
                hidden: elements.get("#enhance-progress").hidden });
              messageListener(await sendNativeMessage());
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
    setTimeout() {}, clearTimeout() {}, URL,
    btoa: (binary) => Buffer.from(binary, "binary").toString("base64"),
    pdfDocumentSessionReady: Promise.resolve({ document: { getData: async () => data, ...documentOverrides } }),
    window: { location: { href: "chrome-extension://viewer/src/viewer.html?url=https%3A%2F%2Fexample.com%2Fsource.pdf#page=9" } },
    resolvePdfSource: async () => ({ originalUrl: new URL(sourceUrl) }),
    resolveDocumentReferenceUrl: async () => "https://example.com/source.pdf",
    chrome: {
      runtime,
      tabs: { getCurrent: async () => ({ id: 42 }), update: async (_, destination) => destinations.push(destination.url) },
    },
  });
  vm.runInContext(source, context);
  await vm.runInContext("enhanceCurrentPdf()", context);
  return { elements, destinations, messages, progressSnapshots };
}

test("missing native host reveals an actual installation link", async () => {
  const { elements } = await enhancerFixture(async () => {
    throw new Error("Specified native messaging host not found.");
  });
  assert.equal(elements.get("#enhance-pdf").hidden, true);
  assert.equal(elements.get("#install-enhancer").hidden, false);
  assert.match(markup, /<a\s+id="install-enhancer"[\s\S]*?href="https:\/\/github.com\/PDF-magic\/viewer#pdf-enhancer-integration"/);
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

test("OCR text layers without born-digital metadata keep deep review", async () => {
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
  assert.equal(messages[0].enhancementMode, "deep");
});

test("progress events update the bar without consuming the final response", async () => {
  const { progressSnapshots, elements, destinations } = await enhancerFixture(async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }));
  assert.deepEqual(progressSnapshots, [{ label: "Enhancing · 2 of 4 pages", value: 50, percentage: "50%", hidden: false }]);
  assert.equal(destinations.length, 1);
  assert.equal(elements.get("#enhance-progress").hidden, true);
});

test("local PDFs use a persistent native connection for progress", async () => {
  const { messages, progressSnapshots } = await enhancerFixture(async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }), "1", undefined, "file:///tmp/source.pdf");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, "enhance-pdf");
  assert.equal(messages[0].progress, true);
  assert.equal(messages[0].enhancementMode, "deep");
  assert.equal(progressSnapshots[0].value, 50);
});
