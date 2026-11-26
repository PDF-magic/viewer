import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatSelectionNotes, normalizeNoteQuote, notesStorageKey,
  resolveNoteOffsets, selectionNotesFilename,
} from "../src/viewer/selection/selection-notes-model.js";

test("notes are scoped by document fingerprint and normalize PDF whitespace", () => {
  assert.equal(notesStorageKey("a-fingerprint", "url"), "pdf-viewer-selection-notes:v1:a-fingerprint");
  assert.notEqual(notesStorageKey(null, "a.pdf"), notesStorageKey(null, "b.pdf"));
  assert.equal(normalizeNoteQuote(" line  one\n line two  "), "line one line two");
});

test("highlight anchors recover after the PDF text spans change", () => {
  const note = { start: 5, end: 10, raw: "apple" };
  assert.deepEqual(resolveNoteOffsets("zero apple", note), { start: 5, end: 10 });
  assert.deepEqual(resolveNoteOffsets("intro zero apple", note), { start: 11, end: 16 });
  assert.equal(resolveNoteOffsets("no matches", note), null);
});

test("export writes sorted quoted passages and notes as portable UTF-8 text", () => {
  const notes = [
    { page: 4, start: 18, raw: "last", quote: "last", text: "Later" },
    { page: 1, start: 2, raw: "first", quote: "first", text: "Earlier" },
  ];
  const output = formatSelectionNotes(notes, "Example PDF", "https://example.test/a.pdf");
  assert.ok(output.startsWith("Example PDF\nSource: https://example.test/a.pdf"));
  assert.ok(output.indexOf("Note 1 — page 1") < output.indexOf("Note 2 — page 4"));
  assert.match(output, /Quote: first\nNote: Earlier/);
  assert.match(output, /Quote: last\nNote: Later/);
  assert.equal(selectionNotesFilename("report.pdf"), "report-notes.txt");
  assert.equal(selectionNotesFilename("../unsafe.pdf"), ".._unsafe-notes.txt");
});

test("viewer exposes the note popover and export beside the minimap controls", () => {
  const html = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
  assert.match(html, /id="selection-note-actions"/);
  assert.match(html, /id="selection-note-editor"/);
  assert.ok(html.indexOf('id="export-selection-notes"') < html.indexOf('id="minimap-swap-side"'));
  assert.match(html, /viewer\/selection\/selection-notes\.js/);
});
