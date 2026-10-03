import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewerSource = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");

test("find shortcut searches selected PDF text", () => {
  assert.match(
    viewerSource,
    /function getSelectedPdfText\(\)[\s\S]*?window\.getSelection\(\)[\s\S]*?viewer\.contains\(selection\.anchorNode\)[\s\S]*?viewer\.contains\(selection\.focusNode\)/,
  );
  assert.match(
    viewerSource,
    /function focusSearchFromSelection\(\)[\s\S]*?searchInput\.value = selectedText;[\s\S]*?focusSearch\(\);[\s\S]*?void runSearch\(selectedText\);/,
  );
  assert.match(
    viewerSource,
    /if \(modifier && key === "f"\)[\s\S]*?focusSearchFromSelection\(\);/,
  );
});
