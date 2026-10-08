import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  findClickableReferences, referenceClicksEnabled,
} from "../src/viewer/navigation/clickable-reference-links.js";

const viewport = {
  width: 600, height: 800,
  convertToViewportPoint: (x, y) => [x, 800 - y],
};
const heading = { title: "3.1 Evidence", reference: "3.1", item: { dest: [2] } };
const targets = new Map([["3.1", [heading]]]);

test("inferred text links are on by default, but an explicit opt-out persists", () => {
  assert.equal(referenceClicksEnabled(null), true);
  assert.equal(referenceClicksEnabled("true"), true);
  assert.equal(referenceClicksEnabled("false"), false);
});

test("explicit footnote, page and uniquely outlined section references are clickable", () => {
  const items = [{ str: "See supra note 7, page 12, and § 3.1 for details." }];
  const links = findClickableReferences(items, { pageCount: 25, sectionTargets: targets, viewport });
  assert.deepEqual(links.map((link) => [link.kind, link.number || link.label]), [
    ["footnote", 7], ["page", 12], ["section", "3.1"],
  ]);
  assert.ok(links.every((link) => link.itemIndex === 0 && link.end > link.start));
  assert.equal(links[2].item, heading.item);
});

test("unknown, ambiguous and grouped section references do not become misleading links", () => {
  const ambiguous = new Map([["3.1", [heading, { ...heading }]]]);
  const source = [{ str: "See section 3.1, section 9 and Sections 3.1, 4.2." }];
  const refs = findClickableReferences(source, { pageCount: 20, sectionTargets: ambiguous, viewport });
  assert.deepEqual(refs, []);
});

test("plain dates and out-of-range page numbers remain unlinked", () => {
  assert.deepEqual(findClickableReferences([{
    str: "Published October 8, 2026. See page 9999 and section 17.",
  }], { pageCount: 23, sectionTargets: new Map(), viewport }), []);
});

test("recognize a confirmed raised numeric footnote marker but not body numbers", () => {
  const body = { str: "Example text", transform: [1, 0, 0, 12, 10, 600], height: 12, width: 55 };
  const superscript = { str: "4", transform: [1, 0, 0, 7, 66, 605], height: 7, width: 4 };
  const plain = { str: "2026", transform: [1, 0, 0, 12, 72, 600], height: 12, width: 24 };
  const links = findClickableReferences([body, superscript, plain], { pageCount: 10, viewport });
  assert.deepEqual(links.map((r) => [r.kind, r.number, r.itemIndex]), [["footnote", 4, 1]]);
});

test("reference preference is in More PDF tools and only controls inferred links", () => {
  const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/viewer/viewer-settings.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/viewer/annotation-layer.css", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
  const footnotes = readFileSync(new URL("../src/viewer/navigation/footnote-jump.js", import.meta.url), "utf8");
  assert.match(markup, /id="tools-menu"[\s\S]*id="clickable-references"[^>]*checked/);
  assert.match(settings, /referenceClicksEnabled\(localStorage\.getItem\(CLICKABLE_REFERENCES_STORAGE_KEY\)\)/);
  assert.match(settings, /classList\.toggle\("clickable-references-disabled", !enabled\)/);
  assert.match(css, /html\.clickable-references-disabled \.clickable-reference-layer\s*\{\s*display: none/);
  assert.match(viewer, /createClickableReferenceLayer\(\{/);
  assert.match(footnotes, /pdf-viewer-inline-footnote-jump/);
  // Embedded PDF links are still handled by PDF.js, not by this preference.
  assert.match(viewer, /new AnnotationLayer\(\{/);
});
