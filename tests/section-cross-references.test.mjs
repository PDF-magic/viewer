import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  outlinedSectionHeadings, findExplicitSectionReferences,
  scanSectionReferencesForPage, groupSectionReferences,
} from '../src/viewer/navigation/section-cross-references.js';

const outline = [
  { title: 'I. Introduction', dest: [0], items: [{ title: 'A. Background', dest: [1] }] },
  { title: 'II. Registration', dest: [2], items: [] },
  { title: '3. Procedures', dest: [3], items: [{ title: '3.1 Evidence', dest: [3] }] },
  { title: 'Summary', dest: [4], items: [{ title: 'B. References', dest: [4] }] },
];

test('index outline headings only from printed numbers (including nested labels)', () => {
  const headings = outlinedSectionHeadings(outline);
  assert.deepEqual(headings.map((h) => h.reference), ['I', 'I.A', 'II', '3', '3.1', 'B']);
  assert.ok(!headings.some((h) => h.title === 'Summary'));
});

test('parse explicit section, part, appendix, and section symbol cross-references', () => {
  const found = findExplicitSectionReferences('See Sections I.A, II and 3.1; § 4(b); Part IV; Appendix A.');
  assert.deepEqual(found.map((f) => f.reference), ['I.A', 'II', '3.1', '4(b)', 'IV', 'A']);
  assert.deepEqual(findExplicitSectionReferences('See note 5 supra, 15 USC 77, and the following heading.'), []);
});

test('preserve font-fragmented references with a navigable page position', () => {
  const viewport = { width: 600, height: 800, convertToViewportPoint: (x, y) => [x, y] };
  const item = (str, x, y, width) => ({ str, transform: [1,0,0,10,x,y], width, height: 10 });
  const references = scanSectionReferencesForPage([
    item('Refer to Sec', 55, 200, 63), item('tion II', 118, 200, 42),
    item('Part I', 360, 200, 40),
    item('See § 3.1 for details', 55, 230, 132),
  ], viewport, 2);
  assert.deepEqual(references.map((ref) => ref.reference), ['II', 'I', '3.1']);
  assert.equal(references[0].pageNumber, 2);
  assert.ok(references[0].highlightRegions[0].top > 0);
  assert.ok(references[0].highlightRegions[0].width < 0.5);
});

test('group matching headings and preserve unresolved and ambiguous links', () => {
  const sections = outlinedSectionHeadings(outline);
  const rows = [
    { reference: 'II', normalizedReference: 'II', pageNumber: 1, text: 'See Section II' },
    { reference: '7', normalizedReference: '7', pageNumber: 2, text: 'See Section 7' },
  ];
  const { groups, unresolved } = groupSectionReferences(sections, rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].heading.title, 'II. Registration');
  assert.equal(groups[0].references.length, 1);
  assert.equal(unresolved[0].reason, 'heading not found');
  const duplicate = groupSectionReferences([...sections, { ...sections[2], item: {} }], rows);
  assert.equal(duplicate.groups.length, 0);
  assert.equal(duplicate.unresolved[0].reason, 'ambiguous heading');
});

test('section cross-reference dialog is linked in viewer', () => {
  const markup = readFileSync(new URL('../src/viewer.html', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../src/viewer/viewer.js', import.meta.url), 'utf8');
  assert.match(markup, /id="section-cross-reference-notes"/);
  assert.match(markup, /id="section-cross-reference-dialog"/);
  assert.match(markup, /viewer\/navigation\/section-cross-reference-panel\.js/);
  assert.match(viewer, /pdf-viewer-section-cross-reference-target/);
});
