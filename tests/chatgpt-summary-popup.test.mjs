import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = (await readFile(new URL("../src/viewer/sharing/summarize-with-chatgpt.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/, "");

function setup({ width = 1080, height = 1920, popupFails = false } = {}) {
  let resolveUrl;
  let click;
  const calls = [];
  const button = {
    title: "Summarize with ChatGPT",
    setAttribute() {},
    addEventListener(event, listener) { click = listener; },
  };
  const context = {
    URL, crypto: { randomUUID: () => "request" },
    setTimeout: () => 0, clearTimeout() {},
    document: { querySelector: () => button },
    window: { screen: { availWidth: width, availHeight: height } },
    resolveDocumentReferenceUrl: () => new Promise((resolve) => { resolveUrl = resolve; }),
    chrome: {
      windows: { async create(options) {
        calls.push(["popup", options]);
        if (popupFails) throw new Error("Popup unavailable");
        return { tabs: [{ id: 7 }] };
      } },
      tabs: {
        async create(options) { calls.push(["tab", options]); return { id: 7 }; },
        async update(id, options) { calls.push(["navigate", options]); },
        async remove() { calls.push(["close"]); },
      },
      storage: { local: {
        async set(payload) { calls.push(["store", payload]); },
        async remove() { calls.push(["remove"]); },
      } },
    },
  };
  vm.runInNewContext(source, context);
  return { click: () => click(), resolveUrl, calls, button };
}

test("opens the portrait popup before PDF metadata resolves, then stores the prompt before navigation", async () => {
  const fixture = setup();
  const pendingClick = fixture.click();
  assert.equal(fixture.calls[0][0], "popup");
  assert.equal(fixture.button.disabled, true);
  const { width, height } = fixture.calls[0][1];
  assert.ok(width > 700 && width < 1080);
  assert.ok(height / width <= 1.2 && height < 1000);
  fixture.resolveUrl("https://example.com/original.pdf");
  await pendingClick;
  assert.deepEqual(fixture.calls.map(([name]) => name), ["popup", "store", "navigate"]);
  assert.ok(fixture.calls[1][1]["pdf-viewer-chatgpt-summary:request"].prompt.endsWith("https://example.com/original.pdf"));
  assert.equal(fixture.button.disabled, false);
});

test("closes the pending popup when no PDF reference exists", async () => {
  const fixture = setup();
  const pendingClick = fixture.click();
  fixture.resolveUrl(null);
  await pendingClick;
  assert.deepEqual(fixture.calls.map(([name]) => name), ["popup", "close"]);
  assert.equal(fixture.button.title, "No PDF URL available");
});

test("falls back to a tab when popup creation fails", async () => {
  const fixture = setup({ popupFails: true });
  const pendingClick = fixture.click();
  fixture.resolveUrl("https://example.com/original.pdf");
  await pendingClick;
  assert.deepEqual(fixture.calls.map(([name]) => name), ["popup", "tab", "store", "navigate"]);
});

test("keeps the popup within a small screen", async () => {
  const fixture = setup({ width: 360, height: 500 });
  const pendingClick = fixture.click();
  const { width, height } = fixture.calls[0][1];
  assert.ok(width <= 360 && height <= 500);
  fixture.resolveUrl(null);
  await pendingClick;
});
