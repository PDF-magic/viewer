import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewerSource = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
const viewerStyles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");

test("zero-result searches use a distinct error-colored state", () => {
  assert.match(viewerSource, /searchCount\.textContent = "No results";\s*setSearchEmptyState\(true\)/);
  assert.match(viewerSource, /function resetSearchResults\(\)[\s\S]*?setSearchEmptyState\(false\)/);
  assert.match(viewerStyles, /\.search-control\.search-empty\s*\{[\s\S]*?border-color: var\(--search-empty\)/);
  assert.match(viewerStyles, /\.search-control\.search-empty \.search-count\s*\{[\s\S]*?color: var\(--search-empty\)/);
});

test("search scheduling normalizes leading and invisible whitespace", () => {
  assert.ok(
    viewerSource.includes('const query = normalizeSearchText(searchInput.value);'),
    "scheduleSearch should use the shared search normalizer",
  );
  assert.ok(
    viewerSource.includes('.replace(/[\\s\\u200B-\\u200D\\u2060\\uFEFF]+/gu, " ")'),
    "search normalization should collapse invisible whitespace separators",
  );
  assert.ok(
    !viewerSource.includes("const query = searchInput.value.trim();"),
    "scheduleSearch should not bypass normalization with trim-only handling",
  );
});
