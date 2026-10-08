import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crossReferencedFootnotes, findFootnoteCrossReferences } from "../src/viewer/navigation/footnote-cross-references.js";

test("finds explicit supra and infra citations in either order", () => {
  assert.deepEqual(findFootnoteCrossReferences(
    "See supra note 12; cf. infra n. 18. Also see footnote 4, supra; notes 21–23 infra.",
  ), [
    { direction: "supra", number: 12 },
    { direction: "infra", number: 18 },
    { direction: "supra", number: 4 },
    { direction: "infra", number: 21 },
    { direction: "infra", number: 22 },
    { direction: "infra", number: 23 },
  ]);
});

test("ignores generic supra/infra and deduplicates the same cited note", () => {
  assert.deepEqual(findFootnoteCrossReferences("See supra Section 8 and infra Part IV; supra note 5; supra n. 5."), [
    { direction: "supra", number: 5 },
  ]);
});

test("resolves nearby matching notes by the cited direction when numbering repeats", () => {
  const notes = [
    { number: 1, pageNumber: 1, text: "First chapter note." },
    { number: 2, pageNumber: 1, text: "See supra note 1 and infra note 1." },
    { number: 1, pageNumber: 4, text: "Next chapter note." },
    { number: 2, pageNumber: 4, text: "See supra note 1 and infra note 8." },
  ];
  const matches = crossReferencedFootnotes(notes);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].references[0].target, notes[0]);
  assert.equal(matches[0].references[1].target, notes[2]);
  assert.equal(matches[1].references[0].target, notes[2]);
  assert.equal(matches[1].references[1].target, null);
});

test("keeps unresolved targets visible instead of jumping to a wrong-direction note", () => {
  const notes = [
    { number: 3, pageNumber: 1, text: "See infra note 2." },
    { number: 2, pageNumber: 3, text: "See infra note 3." },
  ];
  const matches = crossReferencedFootnotes(notes);
  assert.equal(matches[0].references[0].target, notes[1]);
  assert.equal(matches[1].references[0].target, null);
});

test("cross-reference browser is accessible from the PDF viewer's tools menu", () => {
  const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
  assert.match(markup, /id="cross-reference-notes"/);
  assert.match(markup, /id="cross-reference-dialog"/);
  assert.match(markup, /viewer\/navigation\/footnote-cross-reference-panel\.js/);
});
