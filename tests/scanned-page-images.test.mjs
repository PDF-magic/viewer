import assert from "node:assert/strict";
import test from "node:test";
import { hasPageSizedImage } from "../src/viewer/theme/scanned-page-images.js";

function image(x, y, width, height) {
  return [x, y, x, y + height, x + width, y];
}

test("dark mode recognizes a scanned page rendered as one large image", () => {
  assert.equal(hasPageSizedImage(image(0, 0, 0.8, 1)), true);
});

test("dark mode recognizes scanned pages split into rectangular image tiles", () => {
  // GAO report GGD-92-109 reproducer: white scan tiles must not be restored over inversion.
  const tiles = [
    ...image(0, 0, 0.5, 0.5),
    ...image(0.5, 0, 0.5, 0.5),
    ...image(0, 0.5, 0.5, 0.5),
    ...image(0.5, 0.5, 0.5, 0.5),
  ];
  assert.equal(hasPageSizedImage(tiles), true);
  assert.equal(hasPageSizedImage([
    ...image(0, 0, 0.9, 0.5),
    ...image(0, 0.5, 0.9, 0.5),
  ]), true);
});

test("overlapping images do not artificially count as a whole-page scan", () => {
  const repeated = Array.from({ length: 4 }, () => image(0, 0, 0.5, 0.5)).flat();
  assert.equal(hasPageSizedImage(repeated), false);
});

test("separate illustrations still preserve their original colors", () => {
  assert.equal(hasPageSizedImage([
    ...image(0.05, 0.05, 0.45, 0.5),
    ...image(0.55, 0.05, 0.4, 0.5),
  ]), false);
  assert.equal(hasPageSizedImage([]), false);
});
