import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const viewerStyles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");
const toolbarStyles = readFileSync(new URL("../src/viewer/navigation/toolbar-layout.css", import.meta.url), "utf8");
const viewerSource = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");

test("the first page begins directly beneath each toolbar configuration", () => {
  assert.match(viewerStyles, /\.viewer\s*\{[^}]*padding:\s*52px 16px calc\(/);
  assert.match(toolbarStyles, /:where\(:root\.toolbar-two-rows\)[\s\S]*?\.viewer\s*\{\s*padding-top:\s*100px;/);
  assert.match(viewerStyles, /\.enhancement-active \.viewer\s*\{\s*padding-top:\s*94px;/);
  assert.match(viewerStyles, /\.toolbar-two-rows\.enhancement-active \.viewer\s*\{\s*padding-top:\s*142px;/);
});

test("navigating to a short first page scrolls to the document top instead of centering", () => {
  const definition = viewerSource.match(/function goToPage\(pageNumber, behavior = "smooth"\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(definition, "goToPage function should exist");
  const calls = [];
  const page = {
    getBoundingClientRect() { return { top: 52, height: 300 }; },
    scrollIntoView() { assert.fail("First page must not be centered"); },
  };
  const context = vm.createContext({
    pdfDocument: { numPages: 2 },
    setCurrentPage() {},
    queuePageRender() {},
    pageElements: [page],
    window: { innerHeight: 900, scrollY: 300, scrollTo(options) { calls.push(options); } },
  });
  vm.runInContext(`${definition}; goToPage(1, "auto");`, context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].top, 0);
  assert.equal(calls[0].behavior, "instant");
});
