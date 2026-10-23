import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const code = await readFile(new URL("../src/content/chatgpt-summary.js", import.meta.url), "utf8");
const prompt = "Summarize the attached PDF.\n\nSource URL: https://example.com/sample.pdf";
const requestId = "12345678-1234-1234-1234-123456789abc";
const storageKey = "pdf-viewer-chatgpt-summary:" + requestId;

function setup({ background = false, hydrateDuringUpload = false, attachmentRequired = true } = {}) {
  const observers = new Set();
  const listeners = new Map();
  const calls = [];
  const uploads = [];
  const state = { progress: true, chip: false, chipFilename: "", submitted: 0, sentPrompt: "" };
  const notify = () => {
    for (const observer of [...observers]) observer.callback();
  };
  class MockObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  class MockTextarea {
    constructor() { this.value = ""; this.isConnected = true; this.disabled = false; this.readOnly = false; }
    focus() {}
    getClientRects() { return background ? [] : [{}]; }
    dispatchEvent() { notify(); }
  }
  let composer = new MockTextarea();
  class MockTransfer {
    constructor() {
      const files = [];
      this.items = { add(file) { files.push(file); } };
      this.files = files;
    }
  }
  class MockFile {
    constructor(chunks, name) { this.chunks = chunks; this.name = name; }
  }
  const input = {
    accept: ".pdf", disabled: false, files: [],
    dispatchEvent(event) {
      assert.equal(event.type, "change");
      uploads.push(this.files[0]);
      state.chip = true;
      state.chipFilename = this.files[0].name;
      if (hydrateDuringUpload) {
        composer.isConnected = false;
        composer = new MockTextarea();
      }
      notify();
    },
  };
  const button = {
    disabled: false, isConnected: true,
    getAttribute(name) { return name === "aria-label" ? "Send message" : null; },
    getClientRects() { return background ? [] : [{}]; },
    click() {
      state.submitted++;
      state.sentPrompt = composer.value;
      location.href = "https://chatgpt.com/c/" + requestId;
      location.pathname = "/c/" + requestId;
      location.hash = "";
      notify();
    },
  };
  const location = {
    href: "https://chatgpt.com/#pdf-viewer-summary=" + requestId,
    pathname: "/", search: "", hash: "#pdf-viewer-summary=" + requestId,
  };
  const window = {
    location, history: { state: null, replaceState() { location.hash = ""; } },
    getSelection() { return null; },
    addEventListener(name, fn) { listeners.set("window-" + name, fn); },
    removeEventListener(name) { listeners.delete("window-" + name); },
    setTimeout, clearTimeout,
  };
  const document = {
    visibilityState: background ? "hidden" : "visible",
    hasFocus: () => !background,
    querySelector(selector) {
      if (selector === "#prompt-textarea") return composer;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[type="file"]') return [input];
      if (selector === "button") return [button];
      if (selector.includes("data-testid")) {
        return state.chip ? [{
          textContent: state.chipFilename,
          getAttribute() { return null; },
        }] : [];
      }
      return [];
    },
    addEventListener(name, fn) { listeners.set("document-" + name, fn); },
    removeEventListener(name) { listeners.delete("document-" + name); },
  };
  const chrome = {
    storage: { local: {
      async get(key) { return { [key]: { prompt, attachmentRequired, conversationKey: null } }; },
      async remove(key) { calls.push(["remove", key]); },
      async set(value) { calls.push(["store", value]); },
    } },
    runtime: {
      connect(options) {
        const handlers = new Map();
        const port = {
          name: options.name,
          onMessage: { addListener(fn) { handlers.set("message", fn); } },
          onDisconnect: { addListener(fn) { handlers.set("disconnect", fn); } },
          postMessage(message) { calls.push(["port", message]); },
          disconnect() { calls.push(["disconnect"]); },
          deliver(message) { handlers.get("message")?.(message); },
        };
        calls.push(["connect", port.name]);
        ports.push(port);
        return port;
      },
    },
  };
  const ports = [];
  class MockEvent { constructor(type) { this.type = type; } }
  vm.runInNewContext(code, {
    window, document, chrome, URL, URLSearchParams, Event: MockEvent,
    InputEvent: MockEvent, HTMLTextAreaElement: MockTextarea,
    DataTransfer: MockTransfer, File: MockFile, MutationObserver: MockObserver,
    Uint8Array, atob, setInterval, clearInterval,
  });
  const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    state, calls, uploads, ports, flush, getPrompt: () => composer.value, listeners,
    sendPdf() {
      const port = ports[0];
      assert.ok(port, "target port connected");
      port.deliver({ type: "begin", filename: "sample.pdf", byteLength: 4 });
      port.deliver({ type: "chunk", data: "JVBERg==" });
      port.deliver({ type: "end" });
    },
  };
}

test("inserts prompt before PDF upload, then clicks send while progress is still active", async () => {
  const app = setup();
  await app.flush();
  assert.equal(app.getPrompt(), prompt);
  assert.equal(app.uploads.length, 0);
  assert.equal(app.state.submitted, 0);
  app.sendPdf();
  await app.flush();
  assert.equal(app.uploads.length, 1);
  assert.equal(app.state.progress, true);
  assert.equal(app.state.submitted, 1);
  assert.equal(app.state.sentPrompt, prompt);
  assert.ok(app.calls.some(([action, msg]) => action === "port" && msg.type === "finish"));
});

test("background ChatGPT tab can attach and send without layout rects or focus", async () => {
  const app = setup({ background: true });
  await app.flush();
  assert.equal(app.getPrompt(), prompt);
  app.sendPdf();
  await app.flush();
  assert.equal(app.state.submitted, 1);
  assert.equal(app.state.sentPrompt, prompt);
});

test("recovers the summary prompt after ChatGPT replaces the editor during upload", async () => {
  const app = setup({ hydrateDuringUpload: true });
  await app.flush();
  assert.equal(app.getPrompt(), prompt);
  app.sendPdf();
  await app.flush();
  assert.equal(app.state.submitted, 1);
  assert.equal(app.state.sentPrompt, prompt);
});

test("reused summary skips the PDF relay and submits the prompt", async () => {
  const app = setup({ attachmentRequired: false });
  await app.flush();
  assert.equal(app.ports.length, 0);
  assert.equal(app.state.submitted, 1);
  assert.equal(app.state.sentPrompt, prompt);
});
