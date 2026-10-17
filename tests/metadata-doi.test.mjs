import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { doiFromPdfMetadata, doiResolverUrl } from "../src/viewer/metadata-doi.js";

function xmp(fields = {}) {
  return {
    get(key) { return fields[key]; },
    getAll() { return fields; },
  };
}

test("extracts and links bare DOI identifiers from XMP", () => {
  assert.equal(
    doiFromPdfMetadata({}, xmp({ "dc:identifier": ["ISBN 978-1-2345", "doi:10.1000/182"] })),
    "10.1000/182",
  );
  assert.equal(doiResolverUrl("10.1000/182"), "https://doi.org/10.1000/182");
});

test("recognizes resolver URLs and discards URL query parameters", () => {
  assert.equal(
    doiFromPdfMetadata({}, xmp({ "prism:doi": "https://dx.doi.org/10.1038/nphys1170?utm_source=pdf" })),
    "10.1038/nphys1170",
  );
  assert.equal(
    doiFromPdfMetadata({}, xmp({ "dc:identifier": "https://doi.org/10.1000%2Fxyz" })),
    "10.1000/xyz",
  );
});

test("prefers dedicated DOI fields and falls back to custom XMP and PDF Info", () => {
  assert.equal(
    doiFromPdfMetadata({ Custom: { DOI: "10.1000/from-info" } },
      xmp({ "prism:doi": "10.1000/from-xmp", "dc:description": "10.1000/other" })),
    "10.1000/from-xmp",
  );
  assert.equal(
    doiFromPdfMetadata({ Custom: { Citation: "Article: https://doi.org/10.5555/abc." } }, null),
    "10.5555/abc",
  );
  assert.equal(
    doiFromPdfMetadata({ Subject: "See (https://doi.org/10.4321/suffix)." }, null),
    "10.4321/suffix",
  );
  assert.equal(
    doiFromPdfMetadata({}, xmp({ "pdfx:ArticleID": { uri: "https://doi.org/10.7890/abc" } })),
    "10.7890/abc",
  );
});

test("balanced DOI punctuation is preserved and unsafe metadata is never a link target", () => {
  assert.equal(doiFromPdfMetadata({ DOI: "10.1002/(SICI)abc" }, null), "10.1002/(SICI)abc");
  assert.equal(doiResolverUrl("10.1000/a?b#c"), "https://doi.org/10.1000/a%3Fb%23c");
  assert.equal(doiResolverUrl("javascript:alert(1)"), null);
  assert.equal(doiFromPdfMetadata({ Subject: "Nothing identifiable" }, xmp()), null);
  assert.equal(doiFromPdfMetadata({ DOI: 1234 }, null), null);
  assert.equal(doiFromPdfMetadata({}, { get() { throw Error("XMP unavailable"); }, getAll() { throw Error("XMP unavailable"); } }), null);
});

test("viewer exposes a separately linked DOI metadata row next to href", () => {
  const source = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
  assert.match(source, /const doi = doiFromPdfMetadata\(info, metadata\)/);
  assert.match(source, /entries\.push\(\{ label: "DOI", value: doi \}\)/);
  assert.match(source, /label === "DOI" \? doiResolverUrl\(value\)/);
  assert.match(source, /link\.href = linkUrl/);
});
