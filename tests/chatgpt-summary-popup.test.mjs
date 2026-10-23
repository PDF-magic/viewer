import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = (await readFile(new URL("../src/viewer/sharing/summarize-with-chatgpt.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "");

function setup({ width = 1080, height = 1920, popupFails = false } = {}) {
  let resolveUrl;
  const listeners = new Map();
  const calls = [];
  const saved = {};
  const button = {
    title: "Summarize with ChatGPT",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { if (name === "title") this.title = ""; },
    blur() { this.blurred = true; },
    addEventListener(event, listener) { listeners.set(event, listener); },
  };
  const context = {
    URL, Uint8Array, crypto: {
      randomUUID: () => "request",
      subtle: { async digest() { return new Uint8Array([18, 52, 86]).buffer; } },
    },
    pdfDocumentSessionReady: Promise.resolve({ document: { async getData() { return new Uint8Array([37, 80, 68, 70]); } } }),
    setTimeout: () => 0, clearTimeout() {},
    document: { querySelector: () => button },
    window: { screen: { availWidth: width, availHeight: height } },
    resolveDocumentReferenceUrl: () => new Promise((resolve) => { resolveUrl = resolve; }),
    chrome: {
      runtime: { connect(options) {
        calls.push(["connect", options]);
        return { onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} };
      } },
      windows: { async update(id, options) { calls.push(["focus", id, options]); }, async create(options) {
        calls.push(["popup", options]);
        if (popupFails) throw new Error("Popup unavailable");
        return { tabs: [{ id: 7 }] };
      } },
      tabs: {
        async get(id) { return { id, windowId: 9 }; },
        async create(options) { calls.push(["tab", options]); return { id: 7 }; },
        async update(id, options) { calls.push(["navigate", options]); },
        async remove() { calls.push(["close"]); },
      },
      storage: { local: {
        async get(key) { return { [key]: saved[key] }; },
        async set(payload) { Object.assign(saved, payload); calls.push(["store", payload]); },
        async remove(key) { delete saved[key]; calls.push(["remove"]); },
      } },
    },
  };
  vm.runInNewContext(source, context);
  return { click: (event) => listeners.get("click")(event), dispatch: (event) => listeners.get(event)(), resolveUrl, calls, saved, button };
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
  assert.deepEqual(fixture.calls.map(([name]) => name), ["popup", "store", "connect", "navigate"]);
  assert.ok(fixture.calls[1][1]["pdf-viewer-chatgpt-summary:request"].prompt.includes("Source URL: https://example.com/original.pdf"));
  assert.equal(fixture.button.disabled, false);
});

test("clears the native tooltip during popup launch and restores it only on a new hover", async () => {
  const fixture = setup();
  const pendingClick = fixture.click();
  assert.equal(fixture.button.title, "");
  assert.equal(fixture.button.attributes["aria-label"], "Summarize with ChatGPT");
  assert.equal(fixture.button.blurred, true);

  fixture.resolveUrl("https://example.com/original.pdf");
  await pendingClick;
  assert.equal(fixture.button.title, "");
  fixture.dispatch("pointerenter"); // Returning to the PDF without leaving the button.
  assert.equal(fixture.button.title, "");
  fixture.dispatch("pointerleave");
  assert.equal(fixture.button.title, "");
  fixture.dispatch("pointerenter");
  assert.equal(fixture.button.title, "Summarize with ChatGPT");
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
  assert.deepEqual(fixture.calls.map(([name]) => name), ["popup", "tab", "store", "connect", "navigate"]);
});

test("keeps the popup within a small screen", async () => {
  const fixture = setup({ width: 360, height: 500 });
  const pendingClick = fixture.click();
  const { width, height } = fixture.calls[0][1];
  assert.ok(width <= 360 && height <= 500);
  fixture.resolveUrl(null);
  await pendingClick;
});


test("local file URLs are not substituted for PDF attachments", async () => {
  const fixture = setup();
  const click = fixture.click();
  fixture.resolveUrl("file:///Users/example/Documents/Short%20Term%20Securities%20-%201918.pdf");
  await click;
  const data = fixture.calls.find(([action]) => action === "store")[1]["pdf-viewer-chatgpt-summary:request"];
  assert.equal(data.attachmentRequired, true);
  assert.ok(data.prompt.includes("Attached local PDF: Short Term Securities - 1918.pdf"));
  assert.ok(!data.prompt.includes("file:///Users/"));
  assert.equal(fixture.calls.find(([action]) => action === "connect")[1].name, "pdf-summary-source:request");
});

test("reuses a previously uploaded PDF by reopening its existing conversation", async () => {
  const fixture = setup();
  fixture.saved["pdf-viewer-chatgpt-conversation:123456"] = {
    status: "complete",
    url: "https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc",
  };
  const click = fixture.click();
  fixture.resolveUrl("https://example.com/original.pdf");
  await click;
  const data = fixture.calls.find(([action]) => action === "store")[1]["pdf-viewer-chatgpt-summary:request"];
  assert.equal(data.attachmentRequired, false);
  assert.equal(fixture.calls.some(([action]) => action === "connect"), false);
  assert.match(fixture.calls.find(([action]) => action === "navigate")[1].url,
    /^https:\/\/chatgpt.com\/c\/12345678-1234-1234-1234-123456789abc#/);
});

test("refocuses an active upload rather than reattaching the PDF", async () => {
  const fixture = setup();
  fixture.saved["pdf-viewer-chatgpt-conversation:123456"] = {
    status: "pending", tabId: 19, createdAt: Date.now(),
  };
  const click = fixture.click();
  fixture.resolveUrl("https://example.com/original.pdf");
  await click;
  assert.deepEqual(fixture.calls.map(([action]) => action), ["popup", "focus", "navigate", "close"]);
});

test("Shift-click deliberately starts a fresh chat even when the PDF has a saved summary", async () => {
  const fixture = setup();
  fixture.saved["pdf-viewer-chatgpt-conversation:123456"] = {
    status: "complete", url: "https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc",
  };
  const click = fixture.click({ shiftKey: true });
  fixture.resolveUrl("https://example.com/original.pdf");
  await click;
  assert.deepEqual(fixture.calls.map(([action]) => action), ["popup", "store", "connect", "navigate"]);
  const data = fixture.calls[1][1]["pdf-viewer-chatgpt-summary:request"];
  assert.equal(data.attachmentRequired, true);
  assert.equal(data.conversationKey, null);
  assert.match(fixture.calls[3][1].url, /^https:\/\/chatgpt.com\/#/);
});
