import assert from "node:assert/strict";
import test from "node:test";
import { recoverSelectionGaps } from "../src/viewer/selection/selection-gaps.js";
import { selectionLines } from "../src/viewer/selection/selection-lines.js";

const box = (left, right, top, bottom) => ({ left, right, top, bottom });

test("recovers OCR numerals between selected fragments on the same printed line", () => {
  const selected = [box(10, 90, 10, 30), box(230, 450, 10, 30), box(10, 450, 40, 60)];
  const missing = box(90, 230, 10, 30);
  const result = recoverSelectionGaps(selected, [missing]);
  assert.ok(result.includes(missing));
  assert.equal(selectionLines(result)[0].right, 450);
  assert.equal(selectionLines(result)[0].left, 10);
});

test("recovers a short final line skipped before the next paragraph", () => {
  const selected = [box(10, 450, 10, 30), box(50, 450, 90, 110)];
  const missing = box(10, 130, 42, 62);
  assert.ok(recoverSelectionGaps(selected, [missing]).includes(missing));
});

test("does not add other column text or grow the visual selection endpoints", () => {
  const selected = [box(10, 180, 10, 30), box(10, 180, 70, 90)];
  const farColumn = box(250, 360, 40, 60);
  const before = box(10, 180, -15, 5);
  const after = box(10, 180, 100, 120);
  assert.equal(recoverSelectionGaps(selected, [farColumn, before, after]), selected);
});

test("does not fill large vertical gaps or highlight isolated words", () => {
  const selected = [box(10, 180, 10, 30), box(10, 180, 150, 170)];
  assert.equal(recoverSelectionGaps(selected, [box(10, 180, 65, 85)]), selected);
  assert.equal(recoverSelectionGaps([box(10, 30, 10, 30)], [box(31, 90, 10, 30)]).length, 1);
});
