import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createThumbnailCacheKey } from "../src/viewer/navigation/minimap-cache.js";

const source = readFileSync(
  new URL("../src/viewer/navigation/minimap-cache.js", import.meta.url),
  "utf8",
);

test("thumbnail cache keys isolate documents, rotations, and resolutions", () => {
  assert.equal(createThumbnailCacheKey("fingerprint", 90, 40), "fingerprint:90:40:strip-v1");
  assert.notEqual(
    createThumbnailCacheKey("first-document", 0, 40),
    createThumbnailCacheKey("second-document", 0, 40),
  );
});

test("thumbnail cache is persistent and bounded", () => {
  assert.match(source, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/);
  assert.match(source, /MAX_CACHE_ENTRIES\s*=\s*16/);
  assert.match(source, /openKeyCursor\(\)/);
  assert.doesNotMatch(source, /\.getAll\(\)/);
  assert.match(source, /pageCount,[\s\S]*?blob,/);
  assert.doesNotMatch(source, /blobs/);
});
