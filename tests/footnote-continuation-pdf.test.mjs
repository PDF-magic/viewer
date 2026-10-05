import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { appendFootnotesForPage } from "../src/viewer/navigation/footnote-index.js";

test("one footnote highlights both columns and continues onto the next PDF page", async () => {
  const loading = getDocument({
    data: new Uint8Array(readFileSync(new URL("./fixtures/footnote-columns-and-pages.pdf", import.meta.url))),
    standardFontDataUrl: new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname,
  });
  const pdf = await loading.promise;
  try {
    const notes = [];
    let previous;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const { items } = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      appendFootnotesForPage(notes, items, viewport, pageNumber, await page.getOperatorList(), OPS, previous);
      previous = { items, viewport };
    }
    assert.deepEqual(notes.map((note) => note.number), [44, 45]);
    const note = notes[0];
    assert.match(note.text, /START: page 1, left column\..*MIDDLE: page 1, right column\..*END: page 2, left column\./);
    assert.doesNotMatch(note.text, /Page [12] of 2|Separate footnote|Main article|Body text/);
    assert.equal(note.pageNumber, 1);
    assert.equal(note.endPageNumber, 2);
    assert.equal(note.endColumnIndex, 0);
    assert.equal(note.continues, false);
    const regions = note.highlightRegions;
    assert.equal(regions.filter((region) => region.pageNumber === 1 && region.left < 0.5).length, 4);
    assert.equal(regions.filter((region) => region.pageNumber === 1 && region.left > 0.5).length, 4);
    assert.equal(regions.filter((region) => region.pageNumber === 2).length, 3);
    assert.ok(regions.every((region) => region.top > 0.8 && region.top < 0.9));
    assert.ok(regions.filter((region) => region.pageNumber === 2).every((region) => region.top < notes[1].yRatio - 0.02));
  } finally {
    await loading.destroy();
  }
});
