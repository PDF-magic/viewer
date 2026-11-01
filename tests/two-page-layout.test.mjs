import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/viewer/viewer-settings.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");

function loadFunction(name, context) {
  const definition = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(definition, `Missing ${name}`);
  vm.runInContext(definition, context);
}

test("two-page preferences persist and reading position survives toggling", () => {
  const stored = new Map();
  const events = new Map();
  const calls = [];
  const viewer = { dataset: {} };
  const toggle = name => ({
    checked: false,
    disabled: false,
    closest: () => ({ style: {} }),
    addEventListener(event, handler) { events.set(name, handler); },
  });
  const twoPage = toggle("two-page");
  const offset = toggle("offset");
  const selectors = { "#viewer": viewer, "#two-page-view": twoPage, "#offset-cover": offset };
  const context = vm.createContext({
    TWO_PAGE_STORAGE_KEY: "two",
    OFFSET_COVER_STORAGE_KEY: "offset",
    document: { querySelector(selector) { return selectors[selector]; } },
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); },
    },
    styleSettingCheckbox() {},
    captureZoomAnchor() { calls.push("capture"); return { page: 7 }; },
    restoreZoomAnchor(anchor) { calls.push(["restore", anchor]); },
    applyZoomLayout() { calls.push("layout"); },
    syncZoomControls() { calls.push("sync"); },
    scheduleViewerRerender() { calls.push("rerender"); },
  });
  loadFunction("installPageLayoutSettings", context);
  context.installPageLayoutSettings();
  assert.equal(viewer.dataset.pageLayout, "single");
  assert.equal(offset.disabled, true);
  assert.equal(calls.includes("rerender"), false);

  twoPage.checked = true;
  events.get("two-page")();
  assert.equal(viewer.dataset.pageLayout, "two-up");
  assert.equal(offset.disabled, false);
  assert.equal(stored.get("two"), "true");
  assert.equal(calls.at(-1), "rerender");
  assert.deepEqual(calls.at(-3), ["restore", { page: 7 }]);

  offset.checked = true;
  events.get("offset")();
  assert.equal(viewer.dataset.offsetCover, "true");
  assert.equal(stored.get("offset"), "true");

  twoPage.checked = false;
  events.get("two-page")();
  assert.equal(viewer.dataset.pageLayout, "single");
  assert.equal(offset.disabled, true);
  assert.equal(offset.checked, true, "Cover preference is retained in single-page mode");
});

test("grid pairs pages, offsets the first page on request, and resets for print", () => {
  assert.match(html, /id="two-page-view"[^>]*type="checkbox"/);
  assert.match(html, /id="offset-cover"[^>]*type="checkbox"/);
  assert.match(css, /\.viewer\[data-page-layout="two-up"\]\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /\[data-offset-cover="true"\] \.page\[data-page="1"\]\s*\{\s*grid-column:\s*2;/);
  assert.match(css, /@media print\s*\{[\s\S]*?\.viewer\[data-page-layout="two-up"\]\s*\{\s*display:\s*block;/);
});

test("fit-to-width sizes two facing pages within the available width", () => {
  const viewer = { dataset: { pageLayout: "two-up" } };
  const context = vm.createContext({
    PAGE_HORIZONTAL_GUTTER: 32,
    DEFAULT_MAX_PAGE_WIDTH: 1100,
    document: {
      documentElement: { clientWidth: 1200, classList: { contains: () => true } },
      querySelector(selector) { return selector === "#viewer" ? viewer : null; },
    },
    window: { innerWidth: 1200 },
  });
  loadFunction("viewportPageWidth", context);
  loadFunction("fitWidthBase", context);
  assert.equal(context.viewportPageWidth(), 576);
  assert.equal(context.fitWidthBase(), 576);
  viewer.dataset.pageLayout = "single";
  assert.equal(context.viewportPageWidth(), 1168);
  assert.equal(context.fitWidthBase(), 1100);
});
