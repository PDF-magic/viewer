import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewerStyles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");
const toolbarStyles = readFileSync(new URL("../src/viewer/navigation/toolbar-layout.css", import.meta.url), "utf8");

test("narrow PDF pages reach the horizontal viewport edges", () => {
  assert.match(
    viewerStyles,
    /@media \(max-width: 720px\)[\s\S]*?\.viewer\s*\{[\s\S]*?padding-inline:\s*0;[\s\S]*?\}[\s\S]*?\.page\s*\{[\s\S]*?width:\s*100%;[\s\S]*?border-radius:\s*0;[\s\S]*?\}/,
  );
});

test("sections popover clears the second toolbar row", () => {
  assert.match(
    toolbarStyles,
    /:where\(:root\.toolbar-two-rows\)[\s\S]*?\.section-popover\s*\{[\s\S]*?top:\s*calc\(100% \+ 65px\);[\s\S]*?max-height:\s*calc\(100vh - 124px\);[\s\S]*?\}/,
  );
});
