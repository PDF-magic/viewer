import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preview = readFileSync(new URL("../src/loading-preview.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/viewer/loading-screen.css", import.meta.url), "utf8");

test("the standalone preview keeps the loading state visible", () => {
  assert.match(preview, /<html lang="en" class="minimap-preparing">/);
  assert.match(preview, /<div class="status">Loading PDF…<\/div>/);
  assert.match(styles, /\.status:not\(\.error\)::before/);
  assert.match(styles, /rainbow-dash-speedster\.png/);
  assert.match(styles, /background: var\(--loading-image\) center \/ contain no-repeat/);
  assert.doesNotMatch(styles, /content:\s*"Loading PDF…"/);
});
