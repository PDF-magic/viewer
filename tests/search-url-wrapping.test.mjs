import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSearchText, prepareSearchText } from "../src/viewer/search/search-text.js";

test("URL search ignores whitespace inserted by PDF line wrapping", () => {
  const query = normalizeSearchText(
    "https://www.sec.gov/comments/s7-15-23/s71523-301019-767522.pdf",
  );
  const pageText = normalizeSearchText(
    "available at https://www.sec.gov/comments/s7-15-23/s71523- 301019-767522.pdf.",
  );

  assert.equal(pageText.includes(query), false);
  assert.equal(
    prepareSearchText(pageText, query).includes(prepareSearchText(query, query)),
    true,
  );
});

test("ordinary text searches keep whitespace significant", () => {
  const query = normalizeSearchText("market structure");
  const pageText = normalizeSearchText("market   structure");

  assert.equal(prepareSearchText(pageText, query), "market structure");
  assert.equal(prepareSearchText(query, query), "market structure");
});
