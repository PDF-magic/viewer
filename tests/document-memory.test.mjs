import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { PageTextCache } from "../src/viewer/search/page-text-cache.js";
import { footnoteRulesForPage, appendFootnotesForPage } from "../src/viewer/navigation/footnote-index.js";

function loadFunction(path, name, bindings) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const context = vm.createContext(bindings);
  vm.runInContext(source.match(new RegExp(`async function ${name}\\([^]*?\\n\\}`))[0], context);
  return context[name];
}

test("text cache stays within budget, honors recent reads, and skips oversized pages", () => {
  const cache = new PageTextCache(1200);
  const items = [{ str: "sample", transform: [1, 0, 0, 10, 20, 30] }];
  cache.set(1, items);
  cache.set(2, items);
  cache.set(3, items);
  assert.equal(cache.get(1), items);
  cache.set(4, items);
  assert.equal(cache.get(2), undefined);
  assert.equal(cache.get(1), items);
  cache.set(1, [{ str: "x".repeat(2000) }]);
  assert.equal(cache.get(1), undefined);
  for (let i = 0; i < 10000; i++) cache.set(i, items);
  assert.ok(cache.bytes <= 1200);
  assert.ok(cache.entries.size <= 3);
});

test("footnote lookup extracts separator geometry without retaining image operators", async () => {
  let cleanups = 0;
  const viewport = { width: 600, height: 800, convertToViewportPoint: (x, y) => [x, y] };
  const operators = { save: 1, restore: 2, transform: 3, constructPath: 4 };
  const operatorList = { fnArray: [99, 4], argsArray: [
    [{ data: new Uint8Array(1024 * 1024) }],
    [0, [[0, 0]], [60, 600, 200, 600]],
  ] };
  const items = [{ str: "1 A note", height: 8, width: 180, transform: [1, 0, 0, 8, 60, 650] }];
  const page = {
    getTextContent: async () => ({ items }), getViewport: () => viewport,
    getOperatorList: async () => operatorList, cleanup: () => cleanups++,
  };
  const pageData = loadFunction("../src/viewer/navigation/footnote-jump.js", "pageData", { footnoteRulesForPage });
  const data = await pageData({ getPage: async () => page }, 1, operators);
  assert.equal(cleanups, 1);
  assert.deepEqual(Object.keys(data).sort(), ["items", "rules", "viewport"]);
  assert.deepEqual(data.rules, [{ x: 60, y: 600, width: 140 }]);
  const expected = [], actual = [];
  appendFootnotesForPage(expected, items, viewport, 1, operatorList, operators);
  appendFootnotesForPage(actual, items, viewport, 1, null, operators, undefined, data.rules);
  assert.deepEqual(actual, expected);
  page.getOperatorList = async () => { throw new Error("damaged page"); };
  await assert.rejects(pageData({ getPage: async () => page }, 2, operators), /damaged page/);
  assert.equal(cleanups, 2);
});

test("both background indexing passes clean each page, including failures", async () => {
  const cleanups = [], indexed = [];
  const initialize = loadFunction("../src/viewer/navigation/document-scrubber.js", "initializeScrubber", {
    pdfDocumentSessionReady: Promise.resolve({ document: {
      numPages: 3,
      async getPage(number) { return {
        async getTextContent() { if (number === 2) throw new Error("damaged"); return { items: [] }; },
        getViewport: () => ({}), getOperatorList: async () => ({}),
        cleanup: () => cleanups.push(number),
      }; },
    } }),
    appendFootnotesForPage: (...args) => indexed.push(args[3]),
    publishFootnoteIndex() {}, notes: [], setTimeout: (callback) => callback(),
    console: { warn() {} },
  });
  await initialize();
  assert.deepEqual(cleanups, [1, 2, 3, 1, 2, 3]);
  assert.deepEqual(indexed, [1, 3, 1, 3]);
});

test("minimap releases individual thumbnails after composition and partial failure", async () => {
  for (const fails of [false, true]) {
    const canvases = Array.from({ length: 3 }, () => ({ width: 50, height: 70 }));
    let composed = false;
    const renderAll = loadFunction("../src/viewer/navigation/minimap.js", "renderAllThumbnails", {
      thumbnailDocument: { numPages: 3 }, thumbnailGeneration: 1,
      MINIMAP_RENDER_CONCURRENCY: 3, minimapEnabled: () => true,
      viewer: { querySelectorAll: () => [1, 2, 3] }, ensureTiles() {},
      async renderThumbnail(number) {
        if (fails && number === 2) throw new Error("damaged thumbnail");
        return canvases[number - 1];
      },
      composeThumbnailStrip(thumbnails) {
        composed = true;
        assert.ok(thumbnails.every((canvas) => canvas.width === 50));
        return {};
      },
      attachThumbnailStrip() {}, scheduleSync() {}, cacheThumbnailStrip() {},
      yieldToBrowser: async () => {},
    });
    if (fails) await assert.rejects(renderAll(1, Promise.resolve(null)), /damaged thumbnail/);
    else await renderAll(1, Promise.resolve(null));
    assert.equal(composed, !fails);
    assert.equal(canvases[0].width, 0);
    assert.equal(canvases[2].height, 0);
  }
});

test("search extraction releases pages even on failure and cached reads avoid re-extraction", async () => {
  let cleanups = 0, reads = 0;
  let fails = false;
  const getItems = loadFunction("../src/viewer/viewer.js", "getPageSearchItems", {
    pageTextCache: new PageTextCache(),
    pdfDocument: { async getPage() { return {
      async getTextContent() {
        reads++;
        if (fails) throw new Error("damaged text");
        return { items: [{ str: "searchable" }] };
      },
      cleanup: () => cleanups++,
    }; } },
  });
  assert.equal((await getItems(1))[0].str, "searchable");
  await getItems(1);
  assert.equal(reads, 1);
  assert.equal(cleanups, 1);
  fails = true;
  await assert.rejects(getItems(2), /damaged text/);
  assert.equal(cleanups, 2);
});
