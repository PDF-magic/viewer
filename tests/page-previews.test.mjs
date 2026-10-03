import assert from "node:assert/strict";
import test from "node:test";
import { PagePreviews, PreviewCache } from "../src/viewer/page-previews.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture({ count = 40, foreground, renderGate, badPage, width = 600, height = 800, blobBytes } = {}) {
  const canvases = [];
  const renders = [];
  const revoked = [];
  const sharp = new Set();
  const classes = () => ({ add() {}, remove() {} });
  const pages = Array.from({ length: count }, () => ({ style: {}, classList: classes(), append() {} }));
  let urlId = 0;
  const previews = new PagePreviews({
    pages,
    isSharp: (number) => sharp.has(number),
    waitForForeground: () => foreground?.promise,
    yieldToBrowser: () => Promise.resolve(),
    createCanvas: () => {
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob(done) { done(new Blob([blobBytes ? new Uint8Array(blobBytes(this.width)) : "preview"])); },
      };
      canvases.push(canvas);
      return canvas;
    },
    createImage: () => ({ setAttribute() {}, removeAttribute() {}, remove() {} }),
    urls: { createObjectURL: () => `blob:${++urlId}`, revokeObjectURL: (url) => revoked.push(url) },
    pdfDocument: {
      numPages: count,
      async getPage(number) {
        if (number === badPage) throw new Error("Bad page");
        return {
          getViewport: ({ scale, rotation }) => ({ width: (rotation === 90 ? height : width) * scale, height: (rotation === 90 ? width : height) * scale }),
          render({ viewport }) {
            renders.push({ number, viewport });
            return { promise: renderGate?.promise || Promise.resolve() };
          },
          cleanup() {},
        };
      },
    },
  });
  return { previews, canvases, renders, revoked, sharp };
}

async function finish(previews) {
  while (previews.running) await previews.running;
}

test("compressed cache enforces its byte budget and evicts the least recently used entry", () => {
  const evicted = [];
  const cache = new PreviewCache(10, (key) => evicted.push(key));
  const entry = { blob: new Blob(["1234"]) };
  cache.set(1, entry);
  cache.set(2, entry);
  cache.get(1);
  cache.set(3, entry);
  assert.deepEqual(evicted, [2]);
  assert.equal(cache.bytes, 8);
  cache.set(1, { blob: new Blob(["12"]) });
  assert.equal(cache.bytes, 6);
  cache.set(4, { blob: new Blob(["12345678901"]) });
  assert.equal(cache.bytes, 6);
  cache.clear();
  assert.equal(cache.bytes, 0);
});

test("preloads every page, releases all temporary canvases, and mounts only nearby previews", async () => {
  const f = fixture();
  f.previews.start();
  await finish(f.previews);
  assert.equal(f.previews.cache.entries.size, 40);
  assert.equal(f.renders.length, 40);
  assert.ok(f.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
  assert.equal(f.previews.images.size, 9);
  f.previews.update(20);
  assert.equal(f.previews.images.size, 17);
  assert.equal(f.revoked.length, 9);
  await finish(f.previews);
  assert.equal(f.renders.length, 40, "cached navigation never invokes PDF rendering again");
  f.previews.stop();
  assert.equal(f.previews.images.size, 0);
  assert.equal(f.previews.cache.bytes, 0);
  assert.equal(f.revoked.length, 26);
});

test("sharp pages replace previews and distant sharp pages can immediately restore cached images", async () => {
  const f = fixture({ count: 2 });
  f.sharp.add(1);
  f.previews.start();
  await finish(f.previews);
  assert.equal(f.previews.images.has(1), false);
  f.sharp.delete(1);
  f.previews.show(1);
  assert.equal(f.previews.images.has(1), true);
  f.sharp.add(1);
  f.previews.hide(1);
  assert.equal(f.previews.images.has(1), false);
  assert.equal(f.previews.cache.entries.has(1), true);
});

test("foreground rendering runs before background preview rendering", async () => {
  const foreground = deferred();
  const f = fixture({ count: 1, foreground });
  f.previews.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.renders.length, 0);
  foreground.resolve();
  await finish(f.previews);
  assert.equal(f.renders.length, 1);
});

test("rotation discards an in-flight old preview and starts a fresh generation", async () => {
  const renderGate = deferred();
  const f = fixture({ count: 1, renderGate });
  f.previews.start();
  await new Promise((resolve) => setImmediate(resolve));
  f.previews.start(90);
  renderGate.resolve();
  await finish(f.previews);
  const entry = f.previews.cache.get(1);
  assert.ok(entry.width > entry.height);
  assert.equal(f.renders.length, 2);
  assert.ok(f.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test("stopping during a render prevents stale images and releases its canvas", async () => {
  const renderGate = deferred();
  const f = fixture({ count: 1, renderGate });
  f.previews.start();
  await new Promise((resolve) => setImmediate(resolve));
  f.previews.stop();
  renderGate.resolve();
  await finish(f.previews);
  assert.equal(f.previews.cache.bytes, 0);
  assert.equal(f.previews.images.size, 0);
  assert.equal(f.canvases[0].width, 0);
});

test("a damaged page does not prevent caching later pages", async () => {
  const f = fixture({ count: 4, badPage: 2 });
  f.previews.start();
  await finish(f.previews);
  assert.deepEqual([...f.previews.cache.entries.keys()].sort(), [1, 3, 4]);
});

test("unusually tall pages stay within the preview pixel budget", async () => {
  const f = fixture({ count: 1, height: 100000 });
  f.previews.start();
  await finish(f.previews);
  const { viewport } = f.renders[0];
  assert.ok(viewport.width * viewport.height <= 1024 * 1024 + 1);
  assert.equal(viewport.width / viewport.height, 600 / 100000);
});

test("large previews adapt to the per-page budget and release their resize canvases", async () => {
  const f = fixture({ count: 2, blobBytes: (width) => width * 100 });
  f.previews.targetBytes = 30000;
  f.previews.start();
  await finish(f.previews);
  assert.equal(f.previews.cache.entries.size, 2);
  assert.ok([...f.previews.cache.entries.values()].every((entry) => entry.blob.size <= 30000));
  assert.equal(f.canvases.length, 4);
  assert.ok(f.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});
