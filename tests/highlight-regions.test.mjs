import assert from "node:assert/strict";
import test from "node:test";
import { regionPaths } from "../src/viewer/highlight-regions.js";

test("rounded multiline highlights share one closed fill and outline", () => {
  const paths = regionPaths([
    { left: 10, top: 10, width: 100, height: 20 },
    { left: 10, top: 30, width: 50, height: 20 },
  ], 2);
  assert.equal(paths.fill, paths.outline);
  assert.equal((paths.fill.match(/M/g) || []).length, 1);
  assert.equal((paths.fill.match(/Q/g) || []).length, 6);
  assert.match(paths.fill, /Q60 30 60 32/);
  assert.match(paths.fill, /Z$/);
});

test("separate results retain independent rounded boundaries", () => {
  const { fill } = regionPaths([
    { left: 0, top: 0, width: 20, height: 10 },
    { left: 40, top: 0, width: 20, height: 10 },
  ], 2);
  assert.equal((fill.match(/M/g) || []).length, 2);
  assert.equal((fill.match(/Z/g) || []).length, 2);
});

test("rounding fits narrow highlights and handles empty results", () => {
  const { fill } = regionPaths([{ left: 0, top: 0, width: 1, height: 10 }], 2);
  assert.match(fill, /^M0 0.5Q0 0 0.5 0/);
  assert.doesNotMatch(fill, /NaN|Infinity/);
  assert.deepEqual(regionPaths([], 2), { fill: "", outline: "" });
});
