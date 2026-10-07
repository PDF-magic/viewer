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
