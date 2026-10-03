import assert from "node:assert/strict";
import test from "node:test";

import { mergeWrappedUrlTextItems } from "../src/viewer/search/search-text-normalization.js";

function searchableText(items) {
  return items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

test("keeps a wrapped URL searchable as one continuous string", () => {
  const items = [
    { str: "https://www.yalelawjournal.org/article/", hasEOL: true },
    { str: "open-access", hasEOL: false },
  ];

  const merged = mergeWrappedUrlTextItems(items);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].str, "https://www.yalelawjournal.org/article/open-access");
  assert.match(searchableText(merged), /yalelawjournal\.org\/article\/open-access/);
});

test("continues joining a URL wrapped across multiple lines", () => {
  const items = [
    { str: "https://example.com/really/", hasEOL: true },
    { str: "long/", hasEOL: true },
    { str: "path", hasEOL: false },
  ];

  const merged = mergeWrappedUrlTextItems(items);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].str, "https://example.com/really/long/path");
  assert.equal(merged[0].hasEOL, false);
});

test("does not concatenate ordinary words across a line ending", () => {
  const items = [
    { str: "ordinary", hasEOL: true },
    { str: "words", hasEOL: false },
  ];

  assert.deepEqual(mergeWrappedUrlTextItems(items), items);
});

test("does not join a URL when the PDF text contains a real boundary space", () => {
  const items = [
    { str: "https://example.com/path ", hasEOL: true },
    { str: "next", hasEOL: false },
  ];

  assert.deepEqual(mergeWrappedUrlTextItems(items), items);
});
