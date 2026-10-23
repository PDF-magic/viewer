import assert from "node:assert/strict";
import test from "node:test";
import { imageCropPixels, imageRegionsFromCoordinates } from "../src/viewer/images/image-gallery-utils.js";

test("finds individual embedded image bounds in document order", () => {
  const coords = new Float32Array([
    0.2, 0.1, 0.2, 0.4, 0.7, 0.1,
    0.1, 0.6, 0.1, 0.8, 0.4, 0.6,
  ]);
  const regions = imageRegionsFromCoordinates(coords, 600, 800);
  assert.equal(regions.length, 2);
  assert.ok(Math.abs(regions[0].x - 0.2) < 1e-5);
  assert.ok(Math.abs(regions[0].width - 0.5) < 1e-5);
  assert.ok(Math.abs(regions[0].height - 0.3) < 1e-5);
  assert.ok(Math.abs(regions[1].y - 0.6) < 1e-5);
});

test("skips full-page scan backgrounds and tiny decorative icons", () => {
  const coords = [
    0, 0, 0, 1, 1, 0, // scanned full page
    0.1, 0.1, 0.1, 0.12, 0.12, 0.1, // tiny icon
    0.2, 0.2, 0.2, 0.5, 0.7, 0.2, // useful image
  ];
  assert.equal(imageRegionsFromCoordinates(coords, 600, 800).length, 1);
});

test("clamps rotated and out-of-page image corners", () => {
  const regions = imageRegionsFromCoordinates([
    0.3, -0.2, 0.8, 0.3, 0.1, 0.7,
  ], 600, 800);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].x, 0.1);
  assert.equal(regions[0].y, 0);
  assert.ok(regions[0].height > 0);
});

test("pixel crops stay inside render canvas and include fractional edges", () => {
  assert.deepEqual(imageCropPixels({ x: 0.2, y: 0.1, width: 0.5, height: 0.3 }, 101, 201),
    { x: 20, y: 20, width: 51, height: 61 });
  const clipped = imageCropPixels({ x: 0.9, y: 0.9, width: 0.2, height: 0.2 }, 100, 100);
  assert.deepEqual(clipped, { x: 90, y: 90, width: 10, height: 10 });
});
