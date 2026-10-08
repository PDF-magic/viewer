import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const viewerStyles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");
const toolbarStyles = readFileSync(new URL("../src/viewer/navigation/toolbar-layout.css", import.meta.url), "utf8");
const viewerSource = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");

test("the first page preserves a small themed outline gap beneath every toolbar configuration", () => {
  assert.match(viewerStyles, /--page-top-gap:\s*8px;/);
  assert.match(viewerStyles, /\.page\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--page-border\);/);
  assert.match(viewerStyles, /\.viewer\s*\{[^}]*padding:\s*calc\(52px \+ var\(--page-top-gap\)\) 16px calc\(/);
  assert.match(toolbarStyles, /:where\(:root\.toolbar-two-rows\)[\s\S]*?\.viewer\s*\{\s*padding-top:\s*calc\(100px \+ var\(--page-top-gap\)\);/);
  assert.match(viewerStyles, /\.enhancement-active \.viewer\s*\{\s*padding-top:\s*calc\(94px \+ var\(--page-top-gap\)\);/);
  assert.match(viewerStyles, /\.toolbar-two-rows\.enhancement-active \.viewer\s*\{\s*padding-top:\s*calc\(142px \+ var\(--page-top-gap\)\);/);
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
