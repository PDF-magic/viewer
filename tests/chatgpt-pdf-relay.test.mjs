import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const code = await readFile(new URL("../src/background.js", import.meta.url), "utf8");

function setup() {
  let listener;
  const chrome = {
    runtime: {
      id: "test-extension",
      getURL: (path) => "chrome-extension://test-extension" + path,
      getManifest: () => ({ background: { service_worker: "src/background.js" } }),
      onConnect: { addListener(fn) { listener = fn; } },
    },
    mimeHandler: {},
    tabs: { onUpdated: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
  };
  vm.runInNewContext(code, { chrome, URL, URLSearchParams });
  function port(role, senderUrl) {
    const messages = [];
    let onMessage;
    let onDisconnect;
    let closed = false;
    const result = {
      name: "pdf-summary-" + role + ":12345678-1234-1234-1234-123456789abc",
      sender: { url: senderUrl },
      onMessage: { addListener(fn) { onMessage = fn; } },
      onDisconnect: { addListener(fn) { onDisconnect = fn; } },
      postMessage(message) { messages.push(message); },
      disconnect() {
        closed = true;
        onDisconnect?.();
      },
      deliver(message) { onMessage?.(message); },
      get messages() { return messages; },
      get closed() { return closed; },
    };
    listener(result);
    return result;
  }
  return { port };
}

test("relays PDF bytes and acknowledgements only between the matching viewer and ChatGPT request", () => {
  const { port } = setup();
  const source = port("source", "chrome-extension://test-extension/src/viewer.html?url=file%3A%2F%2F%2Ftmp%2Ffile.pdf");
  assert.equal(source.closed, false);
  const target = port("target", "https://chatgpt.com/#pdf-viewer-summary=12345678-1234-1234-1234-123456789abc");
  assert.equal(source.messages[0].type, "start");
  source.deliver({ type: "begin", filename: "source.pdf", byteLength: 4 });
  source.deliver({ type: "chunk", data: "JVBERg==" });
  assert.equal(target.messages[0].type, "begin");
  assert.equal(target.messages[1].type, "chunk");
  target.deliver({ type: "ack" });
  assert.equal(source.messages[1].type, "ack");
  source.deliver({ type: "end" });
  assert.equal(target.messages[2].type, "end");
  target.deliver({ type: "finish" });
  assert.equal(source.messages[2].type, "finish");
});

test("rejects forged sources and mismatched ChatGPT request identifiers", () => {
  const { port } = setup();
  const wrongOrigin = port("source", "https://example.org/src/viewer.html");
  assert.equal(wrongOrigin.closed, true);
  const wrongHash = port("target", "https://chatgpt.com/#pdf-viewer-summary=other");
  assert.equal(wrongHash.closed, true);
});
