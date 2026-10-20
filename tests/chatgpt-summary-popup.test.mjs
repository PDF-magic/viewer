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
  let onDisconnect;
  let lastErrorReads = 0;
  const button = {
    title: "Summarize with ChatGPT",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { if (name === "title") this.title = ""; },
    blur() { this.blurred = true; },
    addEventListener(event, listener) { listeners.set(event, listener); },
  };
  const context = {
    URL, crypto: { randomUUID: () => "request" },
    setTimeout: () => 0, clearTimeout() {},
    document: { querySelector: () => button },
    window: { screen: { availWidth: width, availHeight: height } },
    resolveDocumentReferenceUrl: () => new Promise((resolve) => { resolveUrl = resolve; }),
    chrome: {
      runtime: {
        get lastError() {
          lastErrorReads += 1;
          return { message: "Could not establish connection. Receiving end does not exist." };
        },
        connect(options) {
          calls.push(["connect", options]);
          return {
            onMessage: { addListener() {} },
            onDisconnect: { addListener(listener) { onDisconnect = listener; } },
            disconnect() {},
          };
        },
      },
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
  return {
    click: () => listeners.get("click")(),
    dispatch: (event) => listeners.get(event)(),
    resolveUrl,
    calls,
    button,
    disconnect: () => onDisconnect?.(),
    get lastErrorReads() { return lastErrorReads; },
  };
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

test("consumes Chrome's missing-receiver error on PDF summary disconnection", async () => {
  const fixture = setup();
  const pendingClick = fixture.click();
  fixture.resolveUrl("https://www.sec.gov/files/rules/other/34-16900.pdf");
  await pendingClick;

  assert.equal(fixture.lastErrorReads, 0);
  fixture.disconnect();
  assert.equal(fixture.lastErrorReads, 1);
});
