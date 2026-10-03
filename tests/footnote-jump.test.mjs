import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/viewer/navigation/footnote-jump.js", import.meta.url),
  "utf8",
);
const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");

function loadFootnoteHelpers() {
  const context = vm.createContext({
    document: {
      querySelector() {
        return null;
      },
    },
    Map,
    Math,
    Number,
    Promise,
    RegExp,
    String,
  });
  const runnableSource = source.replace(/^import .*\n/, "");
  vm.runInContext(runnableSource, context);
  return context;
}

test("footnote navigation is exposed in the tools menu", () => {
  assert.match(markup, /id="footnote-jump"/);
  assert.match(markup, /id="footnote-number"/);
  assert.match(markup, /viewer\/navigation\/footnote-jump\.js/);
  assert.match(styles, /\.tool-footnote-jump/);
  assert.match(styles, /\.tool-footnote-status\[data-state="error"\]/);
});

test("footnote lookup prefers a lower-page note over body text and centered page numbers", () => {
  const { candidateForPage } = loadFootnoteHelpers();
  assert.equal(typeof candidateForPage, "function");

  const viewport = {
    width: 600,
    height: 800,
    convertToViewportPoint(x, y) {
      return [x, y];
    },
  };
  const items = [
    { str: "12 ordinary numbered paragraph", height: 12, transform: [1, 0, 0, 12, 60, 280] },
    { str: "Body copy", height: 12, transform: [1, 0, 0, 12, 60, 320] },
    { str: "12", height: 10, transform: [1, 0, 0, 10, 300, 760] },
    { str: "12", height: 8, transform: [1, 0, 0, 8, 62, 690] },
    { str: "Footnote text continues here", height: 8, transform: [1, 0, 0, 8, 82, 690] },
  ];

  const candidate = candidateForPage(items, viewport, 12, 4, 4);
  assert.equal(candidate.pageNumber, 4);
  assert.equal(candidate.label, "12");
  assert.ok(candidate.xRatio < 0.2);
  assert.ok(candidate.yRatio > 0.8);
});

test("footnote lookup rejects a centered footer page number by itself", () => {
  const { candidateForPage } = loadFootnoteHelpers();
  const viewport = {
    width: 600,
    height: 800,
    convertToViewportPoint(x, y) {
      return [x, y];
    },
  };
  const items = [
    { str: "Body copy", height: 12, transform: [1, 0, 0, 12, 60, 320] },
    { str: "12", height: 10, transform: [1, 0, 0, 10, 300, 760] },
  ];

  assert.equal(candidateForPage(items, viewport, 12, 4, 4), undefined);
});
