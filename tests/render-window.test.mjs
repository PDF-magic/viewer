import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
function loadFunction(name, context) {
  const definition = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(definition);
  vm.runInContext(definition, context);
}

test("sharp rendering prioritizes the nearest queued page after a distant jump", () => {
  const context = vm.createContext({
    currentPage: 1800,
    priorityRenderQueue: new Set([1, 1798, 1800, 1802]),
    backgroundRenderQueue: new Set([1799]),
  });
  loadFunction("takeNextQueuedPage", context);
  assert.equal(context.takeNextQueuedPage(), 1800);
});

test("changing render windows releases distant canvases and removes stale priority requests", () => {
  const released = [];
  const queued = [];
  const previews = [];
  const context = vm.createContext({
    pdfDocument: { numPages: 40 }, currentPage: 15, RENDER_WINDOW_RADIUS: 3,
    renderingAllPages: false, renderedPages: new Set([1, 14, 15, 16, 35]),
    staleRenderedPages: new Set([2, 13]),
    priorityRenderQueue: new Set([1, 15, 35]), backgroundRenderQueue: new Set([1, 14, 35]),
    pagePreviews: { update: (number) => previews.push(number) },
    releaseRenderedPage: (number) => released.push(number),
    queuePageRender: (number) => queued.push(number),
  });
  loadFunction("keepRenderWindow", context);
  context.keepRenderWindow();
  assert.deepEqual(released, [1, 35, 2]);
  assert.deepEqual([...context.priorityRenderQueue], [15]);
  assert.deepEqual([...context.backgroundRenderQueue], [14]);
  assert.deepEqual(previews, [15]);
  assert.deepEqual(queued, [12, 13, 14, 15, 16, 17, 18]);
  queued.length = 0;
  context.keepRenderWindow(15, false);
  assert.deepEqual(queued, [], "scrolling may update the window without queuing sharp work");
});

test("printing retains all sharp pages even if the render window changes", () => {
  const context = vm.createContext({
    pdfDocument: { numPages: 40 }, renderingAllPages: true, currentPage: 15,
    pagePreviews: { update() { assert.fail("Printing should not move the preview window"); } },
  });
  loadFunction("keepRenderWindow", context);
  context.keepRenderWindow();
});

test("overlapping resize refreshes retain bitmaps and queue the final viewport before rendering finishes", async () => {
  let finishRender;
  const rendering = new Promise(resolve => { finishRender = resolve; });
  const events = [];
  const context = vm.createContext({
    pdfDocument: { numPages: 40 }, currentPage: 15, RENDER_WINDOW_RADIUS: 3,
    renderGeneration: 0, renderingAllPages: false, sharpRenderTimer: 1,
    renderedPages: new Set([14, 15, 16]), staleRenderedPages: new Set(),
    priorityRenderQueue: new Set(), backgroundRenderQueue: new Set(),
    clearTimeout() {},
    pageAtViewportCenter() { context.currentPage = 16; },
    pagePreviews: { update: number => events.push(["preview", number]) },
    releaseRenderedPage() { assert.fail("A resize must retain the old bitmap until its replacement is ready"); },
    queuePageRender(number, priority) { events.push(["queue", number, priority]); return rendering; },
  });
  loadFunction("keepRenderWindow", context);
  loadFunction("refreshPageRendering", context);
  const first = context.refreshPageRendering();
  const second = context.refreshPageRendering();
  assert.equal(context.renderGeneration, 2);
  assert.equal(context.renderedPages.size, 0);
  assert.deepEqual([...context.staleRenderedPages], [14, 15, 16]);
  assert.equal(events.filter(event => event[0] === "queue" && event[1] === 16 && event[2]).length, 4);
  assert.ok(events.some(event => event[0] === "queue" && event[1] === 19), "Nearby work is queued without waiting for the old render");
  finishRender();
  await Promise.all([first, second]);
});

test("scrolling shows cached previews immediately and defers sharp rendering until it settles", () => {
  const events = [];
  const timers = [];
  const context = vm.createContext({
    pdfDocument: { numPages: 40 }, currentPage: 1, pageNumberInput: { value: "1" },
    previousButton: {}, nextButton: {}, sectionPopover: { hidden: true }, mimeHandlerActive: true,
    renderingAllPages: false,
    priorityRenderQueue: new Set([1]), backgroundRenderQueue: new Set([2]),
    sharpRenderTimer: undefined,
    clearTimeout() {}, setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    pagePreviews: { update: (number) => events.push(["preview", number]) },
    queuePageRender: (number) => events.push(["sharp", number]),
    keepRenderWindow: (number, queueNearby = true) => events.push(["window", number, queueNearby]),
  });
  loadFunction("setCurrentPage", context);
  context.setCurrentPage(30, true);
  assert.deepEqual(events, [["preview", 30], ["window", 30, false]]);
  assert.equal(context.priorityRenderQueue.size, 0);
  assert.equal(context.backgroundRenderQueue.size, 0);
  assert.equal(timers[0].delay, 120);
  timers[0].callback();
  assert.deepEqual(events.slice(2), [["sharp", 30], ["window", 30, true]]);
  context.renderingAllPages = true;
  context.priorityRenderQueue.add(1);
  context.backgroundRenderQueue.add(2);
  context.setCurrentPage(31, true);
  assert.equal(context.priorityRenderQueue.has(1), true, "scroll tracking must retain the print queue");
  assert.equal(context.backgroundRenderQueue.has(2), true);
});
