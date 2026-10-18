import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/viewer/enhance-pdf.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");

function fixture(responseForAction) {
  const elements = new Map();
  const clicks = new Map();
  const identifiers = [
    "enhance-nav", "enhance-pdf", "section-enhance-pdf", "section-popover",
    "section-toggle", "enhancer-setup-dialog", "enhancer-setup-form",
    "enhancer-repository-url", "enhancer-checkout-path", "enhancer-setup-status",
    "enhancer-setup-close", "open-enhancer-setup", "tools-menu", "tools-button",
    "section-nav", "page-number", "toast",
    "enhance-progress", "enhance-progress-bar", "enhance-progress-label",
    "enhance-progress-percentage", "enhance-error-notice",
    "enhance-error-message", "enhance-copy-error", "enhance-dismiss-error",
  ];
  for (const id of identifiers) {
    elements.set(`#${id}`, {
      hidden: id === "enhance-error-notice",
      title: "Enhance PDF",
      value: id === "page-number" ? "7" : "",
      classList: { add() {}, remove() {} },
      style: { setProperty() {} },
      setAttribute() {}, removeAttribute() {},
      addEventListener(type, handler) {
        if (type === "click") clicks.set(id, handler);
      },
      showModal() { this.open = true; }, close() { this.open = false; },
    });
  }
  const updates = [];
  const copies = [];
  const messages = [];
  let onMessage;
  let onDisconnect;
  const runtime = {
    id: "abcdefghijklmnopabcdefghijklmnop",
    getURL: (path) => `chrome-extension://viewer/${path}`,
    connectNative() {
      return {
        onMessage: { addListener(listener) { onMessage = listener; } },
        onDisconnect: { addListener(listener) { onDisconnect = listener; } },
        postMessage(message) {
          messages.push(message);
          Promise.resolve().then(async () => {
            try {
              onMessage(await responseForAction(message.action));
            } catch (error) {
              runtime.lastError = { message: error.message };
              onDisconnect();
            }
          });
        },
        disconnect() {},
      };
    },
  };
  const context = vm.createContext({
    URL, MutationObserver: class { observe() {} },
    setTimeout() {}, clearTimeout() {},
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    navigator: { clipboard: { writeText: async (value) => { copies.push(value); } } },
    chrome: {
      runtime,
      storage: { local: { get: async () => ({}), set: async () => {} } },
      tabs: { getCurrent: async () => ({ id: 4 }), update: async (_, value) => updates.push(value.url) },
    },
    window: {
      location: { href: "https://www.sec.gov/files/rules/sro/dtc/2009/dtcresponse101509.pdf" },
    },
    document: {
      querySelector: (selector) => elements.get(selector),
      documentElement: { classList: { add() {}, remove() {} } },
    },
    resolvePdfSource: async () => ({
      originalUrl: new URL("https://www.sec.gov/files/rules/sro/dtc/2009/dtcresponse101509.pdf"),
    }),
    resolveDocumentReferenceUrl: async () =>
      "https://www.sec.gov/files/rules/sro/dtc/2009/dtcresponse101509.pdf",
    pdfDocumentSessionReady: Promise.resolve({ document: {
      getData: async () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]),
    } }),
    downloadSetupZip() {},
  });
  vm.runInContext(source, context);
  return { run: () => vm.runInContext("enhanceCurrentPdf()", context),
    elements, clicks, updates, copies, messages };
}

test("MIME-handler success navigates to the extension viewer, not an SEC query URL", async () => {
  const scenario = fixture(async (action) => action === "enhance-pdf-finish"
    ? { ok: true, outputUrl: "file:///tmp/scan-enhanced.pdf" }
    : { ok: true });
  await scenario.run();
  assert.deepEqual(scenario.updates, [
    "chrome-extension://viewer/src/viewer.html?url=file%3A%2F%2F%2Ftmp%2Fscan-enhanced.pdf#page=7",
  ]);
  assert.equal(scenario.elements.get("#enhance-error-notice").hidden, true);
});

test("OCR failure remains readable and can be copied or dismissed", async () => {
  const scenario = fixture(async (action) => action === "enhance-pdf-finish"
    ? { ok: false, error: "OCRmyPDF: Tesseract returned exit 7" }
    : { ok: true });
  await scenario.run();
  assert.equal(scenario.elements.get("#enhance-progress").hidden, true);
  assert.equal(scenario.elements.get("#enhance-error-notice").hidden, false);
  assert.match(scenario.elements.get("#enhance-error-message").textContent, /Running OCR: OCRmyPDF: Tesseract returned exit 7/);
  assert.deepEqual(scenario.updates, []);
  await scenario.clicks.get("enhance-copy-error")();
  assert.match(scenario.copies[0], /Tesseract returned exit 7/);
  scenario.clicks.get("enhance-dismiss-error")();
  assert.equal(scenario.elements.get("#enhance-error-notice").hidden, true);
});

test("upload rejection preserves the stage at which the 0% progress failed", async () => {
  const scenario = fixture(async (action) => action === "enhance-pdf-start"
    ? { ok: false, error: "native host rejected the request" }
    : { ok: true });
  await scenario.run();
  assert.equal(scenario.elements.get("#enhance-error-notice").hidden, false);
  assert.match(scenario.elements.get("#enhance-error-message").textContent,
    /^Sending PDF bytes: native host rejected the request$/);
});
