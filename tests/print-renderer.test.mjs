import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PRINT_DPI, printPageMetrics } from "../src/viewer/print-renderer.js";

test("print pages render at 300 DPI while retaining PDF point width", () => {
  const metrics = printPageMetrics({ width: 612, height: 792 });

  assert.equal(PRINT_DPI, 300);
  assert.equal(metrics.scale, 300 / 72);
  assert.equal(metrics.pixelWidth, 2550);
  assert.equal(metrics.pixelHeight, 3300);
  assert.equal(metrics.cssWidth, "612pt");
});

test("print metrics preserve rotated physical dimensions", () => {
  const metrics = printPageMetrics({ width: 792, height: 612 });

  assert.equal(metrics.pixelWidth, 3300);
  assert.equal(metrics.pixelHeight, 2550);
  assert.equal(metrics.cssWidth, "792pt");
});

test("print CSS removes browser page margins and uses the dedicated print document", () => {
  const styles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");

  assert.match(styles, /^@page\s*{\s*margin:\s*0;/m);
  assert.match(styles, /:root\.pdf-print-ready \.viewer[\s\S]*display:\s*none !important;/);
  assert.match(styles, /:root\.pdf-print-ready \.print-document\s*{\s*display:\s*block;/);
});
