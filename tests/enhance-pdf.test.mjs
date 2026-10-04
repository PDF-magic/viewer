import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/viewer/enhance-pdf.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");
const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");

async function enhancerFixture(sendNativeMessage) {
  const elements = new Map();
  for (const id of ["enhance-nav", "enhance-pdf", "install-enhancer", "section-nav", "page-number", "toast"]) {
    elements.set(`#${id}`, {
      hidden: id !== "enhance-pdf",
      title: "Enhance PDF",
      value: "1",
      setAttribute() {},
      addEventListener() {},
      classList: { add() {}, remove() {} },
    });
  }
  const destinations = [];
  const context = vm.createContext({
    document: { querySelector: (selector) => elements.get(selector) },
    MutationObserver: class { observe() {} },
    setTimeout() {}, clearTimeout() {}, URL,
    resolvePdfSource: async () => ({ originalUrl: new URL("https://example.com/source.pdf") }),
    resolveDocumentReferenceUrl: async () => "https://example.com/source.pdf",
    chrome: {
      runtime: { sendNativeMessage },
      tabs: { getCurrent: async () => ({ id: 42 }), update: async (_, destination) => destinations.push(destination.url) },
    },
  });
  vm.runInContext(source, context);
  await vm.runInContext("enhanceCurrentPdf()", context);
  return { elements, destinations };
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

test("successful enhancement opens the returned local PDF", async () => {
  const { destinations } = await enhancerFixture(async () => ({ ok: true, outputUrl: "file:///tmp/enhanced.pdf" }));
  assert.deepEqual(destinations, ["file:///tmp/enhanced.pdf"]);
});
