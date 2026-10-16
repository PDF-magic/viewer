import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/viewer/viewer-settings.js", import.meta.url), "utf8");

function loadFunction(name, context) {
  const definition = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(definition, `Missing ${name}`);
  vm.runInContext(definition, context);
}

test("fit height fills the space between the actual toolbar and bottom controls", () => {
  let paddingTop = 53;
  let scrubberHeight = 28;
  const context = vm.createContext({
    TOOLBAR_HEIGHT: 52,
    window: { innerHeight: 900 },
    getComputedStyle: () => ({ paddingTop: `${paddingTop}px` }),
    document: {
      querySelector: (selector) => selector === "#viewer" ? {} : {
        getBoundingClientRect: () => ({ height: scrubberHeight, top: 900 - scrubberHeight }),
      },
    },
  });
  loadFunction("viewportPageTop", context);
  loadFunction("viewportPageHeight", context);
  assert.equal(context.viewportPageHeight(), 818);
  paddingTop = 143;
  assert.equal(context.viewportPageHeight(), 728);
  scrubberHeight = 0;
  assert.equal(context.viewportPageHeight(), 756);
});

function fixture() {
  let pageHeight = 1000;
  let pageDocumentTop = 90_000;
  let alternateLayout = false;
  const page = {
    getBoundingClientRect() {
      return {
        top: pageDocumentTop - context.window.scrollY,
        height: pageHeight,
      };
    },
  };
  const pageNumberInput = { value: "90" };
  const context = vm.createContext({
    TOOLBAR_HEIGHT: 52,
    window: {
      innerWidth: 1200,
      innerHeight: 900,
      scrollX: 0,
      scrollY: 89_900,
      scrollTo({ left, top }) {
        this.scrollX = left;
        this.scrollY = top;
      },
    },
    document: {
      elementFromPoint() {
        return { closest(selector) { return selector === ".page" ? page : null; } };
      },
      querySelector(selector) {
        if (selector === "#page-number") return pageNumberInput;
        if (selector === '.page[data-page="90"]') return page;
        return null;
      },
    },
    applyZoomLayout() {
      alternateLayout = !alternateLayout;
      pageDocumentTop = alternateLayout ? 120_000 : 90_000;
      pageHeight = alternateLayout ? 500 : 1000;
    },
  });

  loadFunction("captureZoomAnchor", context);
  loadFunction("restoreZoomAnchor", context);
  loadFunction("applyZoomLayoutPreservingPosition", context);
  return { context, page };
}

test("zoom layout changes keep the same reading point anchored in the viewport", () => {
  const { context, page } = fixture();
  const viewportY = 52 + (900 - 52) / 2;
  const before = context.captureZoomAnchor();

  context.applyZoomLayoutPreservingPosition();

  const rect = page.getBoundingClientRect();
  assert.equal(rect.top + rect.height * before.ratio, viewportY);
});

test("repeated zoom layout changes do not drift to another part of the document", () => {
  const { context, page } = fixture();
  const viewportY = 52 + (900 - 52) / 2;
  const initialAnchor = context.captureZoomAnchor();

  for (let index = 0; index < 20; index += 1) {
    context.applyZoomLayoutPreservingPosition();
    const rect = page.getBoundingClientRect();
    assert.equal(rect.top + rect.height * initialAnchor.ratio, viewportY);
  }
});

test("one fit-height click uses the visible page and settles its height before paint", () => {
  const frames = [];
  const stalePage = { isConnected: true };
  const visiblePage = { isConnected: true };
  let renderedHeight = 600;
  let alignedPage = null;
  let alignedTop = null;
  let layoutCalls = 0;
  const context = vm.createContext({
    window: { innerWidth: 1200 },
    document: {
      elementFromPoint(x, y) {
        assert.equal(x, 600);
        assert.equal(y, 462);
        return { closest: (selector) => selector === ".page" ? visiblePage : null };
      },
      querySelector(selector) {
        if (selector === "#page-number") return { value: "6" };
        if (selector === '.page[data-page="6"]' || selector === ".page") return stalePage;
        return null;
      },
    },
    viewportPageTop: () => 53,
    viewportPageHeight: () => 818,
    applyZoomLayout() {
      layoutCalls += 1;
      renderedHeight = layoutCalls === 1 ? 600 : 818;
    },
    restoreZoomAnchor(anchor) {
      alignedPage = anchor.page;
      alignedTop = anchor.viewportY;
    },
    syncZoomControls() {},
    scheduleViewerRerender() {},
    requestAnimationFrame(callback) { frames.push(callback); },
  });
  loadFunction("fitHeight", context);

  context.fitHeight();
  assert.equal(alignedPage, visiblePage);
  assert.equal(alignedTop, 53);
  assert.equal(renderedHeight, 600);
  assert.equal(frames.length, 1);

  frames.shift()();
  assert.equal(layoutCalls, 2);
  assert.equal(renderedHeight, 818);
  assert.equal(alignedPage, visiblePage);
  assert.equal(alignedTop, 53);
});

test("pending fit-height correction does not override a later zoom mode", () => {
  const frames = [];
  let layoutCalls = 0;
  const context = vm.createContext({
    window: { innerWidth: 1000 },
    document: {
      elementFromPoint: () => null,
      querySelector: (selector) => selector === "#page-number" ? { value: "1" } : null,
    },
    viewportPageTop: () => 53,
    viewportPageHeight: () => 700,
    applyZoomLayout() { layoutCalls += 1; },
    restoreZoomAnchor() {},
    syncZoomControls() {},
    scheduleViewerRerender() {},
    requestAnimationFrame(callback) { frames.push(callback); },
  });
  loadFunction("fitHeight", context);
  context.fitHeight();
  vm.runInContext('zoomMode = "fit-width"', context);
  frames.shift()();
  assert.equal(layoutCalls, 1);
});
