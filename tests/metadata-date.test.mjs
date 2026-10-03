import assert from "node:assert/strict";
import test from "node:test";

import { formatMetadataDate } from "../src/viewer/metadata-date.js";

test("formats PDF dates in UTC", () => {
  assert.equal(
    formatMetadataDate("D:20261204050400-04'00'"),
    "4 Dec 2026 at 9:04 UTC",
  );
  assert.equal(
    formatMetadataDate("D:20260721165525-04'00'"),
    "21 Jul 2026 at 20:55 UTC",
  );
  assert.equal(
    formatMetadataDate("D:20261204143400+05'30'"),
    "4 Dec 2026 at 9:04 UTC",
  );
});

test("formats timezone-aware XMP dates in UTC", () => {
  assert.equal(
    formatMetadataDate("2026-12-04T09:04:00Z"),
    "4 Dec 2026 at 9:04 UTC",
  );
  assert.equal(
    formatMetadataDate("2026-12-04T10:04:00+01:00"),
    "4 Dec 2026 at 9:04 UTC",
  );
});

test("leaves dates without a known timezone unchanged", () => {
  assert.equal(formatMetadataDate("D:20261204090400"), "D:20261204090400");
  assert.equal(formatMetadataDate("not a date"), "not a date");
});
