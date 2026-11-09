import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewerStyles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");
const toolbarStyles = readFileSync(new URL("../src/viewer/navigation/toolbar-layout.css", import.meta.url), "utf8");
const minimapStyles = readFileSync(new URL("../src/viewer/navigation/minimap.css", import.meta.url), "utf8");

test("narrow PDF pages preserve rounded, outlined corners with side clearance", () => {
  assert.match(viewerStyles, /\.page\s*\{[^}]*border-radius:\s*8px;[^}]*box-shadow:\s*0 0 0 1px var\(--page-border\);/);
  assert.match(viewerStyles, /\.viewer\s*\{[^}]*padding:\s*calc\(52px \+ var\(--page-top-gap\)\) 16px/);
  const narrowRules = viewerStyles.split("@media (max-width: 720px) {").at(-1).split("@media (max-width: 560px) {")[0];
  assert.match(narrowRules, /\.viewer\s*\{\s*padding-inline:\s*8px;/);
  assert.doesNotMatch(narrowRules, /\.page\s*\{/);
});

test("rendered page surfaces inherit the rounded page corners", () => {
  assert.match(
    viewerStyles,
    /\.page canvas,[\s\S]*?\.page-preview\s*\{[\s\S]*?border-radius:\s*inherit;/,
  );
});

test("sections popover clears the second toolbar row", () => {
  assert.match(
    toolbarStyles,
    /:where\(:root\.toolbar-two-rows\)[\s\S]*?\.section-popover\s*\{[\s\S]*?top:\s*calc\(100% \+ 65px\);[\s\S]*?max-height:\s*calc\(100vh - 124px\);[\s\S]*?\}/,
  );
});

test("split-width minimap controls reserve space above the host corner overlay", () => {
  assert.match(
    minimapStyles,
    /@media \(max-width: 1200px\)[\s\S]*?--split-view-bottom-clearance:\s*48px;/,
  );
  assert.match(
    minimapStyles,
    /\.minimap-shell\s*\{[\s\S]*?inset:\s*52px 0 calc\(var\(--document-scrubber-height, 0px\) \+ var\(--split-view-bottom-clearance\)\) auto;/,
  );
  assert.match(
    minimapStyles,
    /\.minimap-collapsed \.minimap-shell\s*\{[\s\S]*?top:\s*auto;/,
  );
});

test("footnote scrubber leaves split-view host controls unobstructed", () => {
  assert.match(
    viewerStyles,
    /@media \(max-width: 1200px\)\s*\{\s*\.document-scrubber\s*\{\s*padding-right:\s*calc\(12px \+ var\(--split-view-bottom-clearance\)\);/,
  );
});

test("PDF tools menu stays within the viewport and scrolls to all settings", () => {
  assert.match(
    viewerStyles,
    /\.tools-menu\s*\{[\s\S]*?max-height:\s*calc\(100dvh - 64px\);[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/,
  );
});
