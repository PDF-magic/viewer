import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/viewer/navigation/rapid-page-navigation.js", import.meta.url), "utf8");

test("rapid page navigation anchors short and tall pages to the actual toolbar", () => {
  for (const pageHeight of [300, 1400]) {
    const calls = [];
    const page = {
      getBoundingClientRect() { return { top: 700, height: pageHeight }; },
      scrollIntoView() { assert.fail("Pages must not be centered"); },
    };
    const viewer = { querySelector() { return page; } };
    const input = { value: "2", max: "4", addEventListener() {} };
    const button = { addEventListener() {} };
    const document = {
      querySelector(selector) {
        if (selector === "#viewer") return viewer;
        if (selector === "#page-number") return input;
        if (selector === ".toolbar") return { getBoundingClientRect: () => ({ height: 100 }) };
        if (selector === "#enhance-progress") return { getBoundingClientRect: () => ({ height: 42 }) };
        return button;
      },
    };
    const window = { scrollY: 200, scrollTo(options) { calls.push(options); } };
    vm.runInContext(source + "\nscrollToPageImmediately(2); scrollToPageImmediately(1);", vm.createContext({ document, window }));
    assert.equal(calls[0].top, 757);
    assert.equal(calls[0].behavior, "auto");
    assert.equal(calls[1].top, 0);
  }
});
