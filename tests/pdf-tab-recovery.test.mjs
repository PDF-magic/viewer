import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const worker = await readFile(new URL("../src/background/pdf-tab-recovery.js", import.meta.url), "utf8");
const VIEWER = "chrome-extension://test-extension/src/viewer.html";

function setup({ fileAccess = true } = {}) {
  const events = {};
  const openTabs = new Map();
  const stored = {};
  const calls = { create: [], update: [], reload: [] };
  let nextId = 100;

  const chrome = {
    runtime: {
      getURL: (path) => "chrome-extension://test-extension/" + path,
      onInstalled: { addListener(fn) { events.install = fn; } },
      onMessage: { addListener(fn) { events.message = fn; } },
    },
    extension: { async isAllowedFileSchemeAccess() { return fileAccess; } },
    storage: {
      local: {
        async get(key) { return { [key]: stored[key] }; },
        async set(values) { Object.assign(stored, values); },
      },
    },
    tabs: {
      onUpdated: { addListener(fn) { events.updated = fn; } },
      onRemoved: { addListener(fn) { events.removed = fn; } },
      async query() { return [...openTabs.values()]; },
      async create(options) {
        calls.create.push(options);
        const tab = {
          id: nextId++, url: options.url, windowId: options.windowId ?? 1,
          index: options.index ?? 0, active: options.active, pinned: options.pinned,
        };
        openTabs.set(tab.id, tab);
        return tab;
      },
      async update(id, changes) {
        calls.update.push({ id, ...changes });
        const tab = { ...openTabs.get(id), ...changes };
        openTabs.set(id, tab);
        return tab;
      },
      async reload(id) { calls.reload.push(id); },
    },
  };

  vm.runInNewContext(worker, {
    chrome, URL, console,
    setTimeout: (fn, milliseconds) => setTimeout(fn, milliseconds >= 1200 ? 5 : milliseconds),
  });

  async function opened(tab, source, page, mimeHandlerActive) {
    openTabs.set(tab.id, tab);
    const result = await new Promise((resolve) => events.message({
      type: "pdf-viewer:opened", sourceUrl: source, page, mimeHandlerActive,
    }, { url: VIEWER, tab }, resolve));
    assert.equal(result.ok, true);
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 35));
  return { events, openTabs, stored, calls, opened, tick };
}

test("a local redirected PDF returns in the same window with its physical page", async () => {
  const fixture = setup();
  const source = "file:///Users/example/My%20Report.pdf";
  const tab = {
    id: 12, windowId: 6, index: 4, active: true, pinned: true,
    url: VIEWER + "?url=" + encodeURIComponent(source),
  };
  await fixture.opened(tab, source, 19, false);
  fixture.openTabs.delete(12); // Chrome closed the extension-owned tab while reloading.
  fixture.events.install({ reason: "update" });
  await fixture.tick();

  assert.equal(fixture.calls.create.length, 1);
  const restored = fixture.calls.create[0];
  assert.equal(restored.windowId, 6);
  assert.equal(restored.index, 4);
  assert.equal(restored.active, true);
  assert.equal(restored.pinned, true);
  assert.equal(new URL(restored.url).searchParams.get("url"), source);
  assert.equal(new URL(restored.url).hash, "#page=19");
  assert.equal(Object.keys(fixture.stored["pdf-viewer-open-tabs-v1"]).length, 1);
});

test("MIME-handler local PDFs reopen with file URLs, not ephemeral blob streams", async () => {
  const fixture = setup();
  const source = "file:///tmp/local.pdf";
  await fixture.opened({ id: 7, url: source, windowId: 1, index: 0 }, source, 8, true);
  fixture.openTabs.delete(7);
  fixture.events.install({ reason: "update" });
  await fixture.tick();
  assert.equal(fixture.calls.create.length, 1);
  assert.equal(fixture.calls.create[0].url, "file:///tmp/local.pdf#page=8");
});

test("local files cannot be reopened without Chrome file-scheme permission", async () => {
  const fixture = setup({ fileAccess: false });
  const source = "file:///tmp/restricted.pdf";
  await fixture.opened({ id: 7, url: source, windowId: 1, index: 0 }, source, 8, true);
  fixture.openTabs.delete(7);
  fixture.events.install({ reason: "update" });
  await fixture.tick();
  assert.equal(fixture.calls.create.length, 0);
  assert.equal(Object.keys(fixture.stored["pdf-viewer-open-tabs-v1"]).length, 1);
});

test("web PDFs reload in the existing tab instead of duplicating it", async () => {
  const fixture = setup();
  const source = "https://example.org/document.pdf";
  await fixture.opened({ id: 7, url: source, windowId: 1, index: 0 }, source, 8, true);
  fixture.events.install({ reason: "update" });
  await fixture.tick();
  assert.equal(fixture.calls.create.length, 0);
  assert.deepEqual(fixture.calls.update, [{ id: 7, url: source + "#page=8" }]);
});

test("intentionally closed PDFs do not return on a later extension reload", async () => {
  const fixture = setup();
  const source = "https://example.org/document.pdf";
  await fixture.opened({ id: 7, url: source, windowId: 1, index: 0 }, source, 8, true);
  fixture.openTabs.delete(7);
  fixture.events.removed(7);
  await fixture.tick(); // Allow the close cleanup to finish before the reload.
  fixture.events.install({ reason: "update" });
  await fixture.tick();
  assert.equal(fixture.calls.create.length, 0);
});

test("unrelated browser tabs are never overwritten with old PDFs", async () => {
  const fixture = setup();
  const source = "https://example.org/document.pdf";
  await fixture.opened({ id: 7, url: source, windowId: 1, index: 0 }, source, 8, true);
  fixture.openTabs.set(7, { id: 7, url: "https://example.org/home", windowId: 1, index: 0 });
  fixture.events.install({ reason: "update" });
  await fixture.tick();
  assert.equal(fixture.calls.create.length, 0);
  assert.equal(fixture.calls.update.length, 0);
  assert.equal(Object.keys(fixture.stored["pdf-viewer-open-tabs-v1"]).length, 0);
});
