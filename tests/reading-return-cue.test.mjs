import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  closestReadingRectangle,
  relativeReadingRectangle,
} from "../src/viewer/selection/reading-return-cue.js";

const source = readFileSync(
  new URL("../src/viewer/selection/reading-return-cue.js", import.meta.url), "utf8",
);
const styles = readFileSync(
  new URL("../src/viewer/selection/reading-return-cue.css", import.meta.url), "utf8",
);
const html = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");

test("the text rectangle closest to the pointer determines the reading position", () => {
  const upper = { left: 20, right: 80, top: 10, bottom: 22, width: 60, height: 12 };
  const lower = { left: 20, right: 90, top: 35, bottom: 48, width: 70, height: 13 };
  assert.equal(closestReadingRectangle([upper, lower], 42, 40), lower);
  assert.equal(closestReadingRectangle([upper, lower], 42, 14), upper);
  assert.equal(closestReadingRectangle([], 42, 14), null);
  assert.equal(closestReadingRectangle([{ left: 0, right: 0, top: 0, bottom: 1, width: 0, height: 1 }], 0, 0), null);
});

test("click coordinates stay proportional to the page through zoom and clipping", () => {
  const page = { left: 100, top: 50, right: 500, bottom: 850, width: 400, height: 800 };
  const word = { left: 200, top: 250, right: 280, bottom: 270, width: 80, height: 20 };
  assert.deepEqual(relativeReadingRectangle(page, word), {
    left: 25, top: 25, width: 20, height: 2.5,
  });
  assert.deepEqual(relativeReadingRectangle(page, {
    left: 90, top: 45, right: 140, bottom: 65, width: 50, height: 20,
  }), { left: 0, top: 0, width: 10, height: 1.875 });
  assert.equal(relativeReadingRectangle(page, {
    left: 600, right: 620, top: 50, bottom: 70, width: 20, height: 20,
  }), null);
});

test("the reminder appears only after leaving the viewer and survives refocus", () => {
  assert.match(source, /window\.addEventListener\("blur", revealLocation\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /document\.visibilityState === "hidden"/);
  assert.match(source, /window\.addEventListener\("focus"[\s\S]*?if \(isShown\) drawCue\(\)/);
  assert.match(source, /viewer\.addEventListener\("pointerdown"/);
  assert.match(source, /viewer\.addEventListener\("pointerup"/);
  assert.match(source, /if \(pageChanged\) drawCue\(\)/);
});

test("the right-side pointer is separate from the existing search arrow", () => {
  assert.match(styles, /border-right: 9px solid/);
  assert.match(styles, /right: 7px/);
  assert.match(html, /viewer\/selection\/reading-return-cue\.css/);
  assert.match(html, /viewer\/selection\/reading-return-cue\.js/);
});
