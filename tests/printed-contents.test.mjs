import { readFileSync } from "node:fs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { findPrintedContentsEntries, resolvePrintedContentsPage, contentsEntryHasEmbeddedLink } from '../src/viewer/navigation/printed-contents.js';

const viewport = {
  width: 600, height: 800, scale: 1,
  convertToViewportPoint(x, y) { return [x, 800 - y]; },
};
const fragment = (str, x, baseline) => ({ str, transform: [10,0,0,10,x,800-baseline], width: str.length * 5, height: 10 });
const heading = fragment('Table of Contents', 60, 90);

test('printed TOC entries become targetable regions even without annotations', () => {
  const items = [heading,
    fragment('I. Introduction ............ 4', 60, 125),
    fragment('II. Procedures ............. 27', 60, 150),
    fragment('Running footer 2', 60, 780),
  ];
  const rows = findPrintedContentsEntries(items, viewport);
  assert.deepEqual(rows.map(row => [row.title, row.label]), [['I. Introduction', '4'], ['II. Procedures', '27']]);
  assert.ok(rows.every(row => row.width > 100 && row.top > 80));
});

test('font-fragmented lines and continued contents are recognized', () => {
  const items = [fragment('Contents (continued)',60,60),
    fragment('Appendix A',60,100), fragment('  ',180,100), fragment('18',240,100),
    fragment('References',60,126), fragment('  ',180,126), fragment('xii',240,126),
  ];
  const rows = findPrintedContentsEntries(items, viewport);
  assert.deepEqual(rows.map(row => row.label), ['18', 'xii']);
});

test('ordinary prose is never decorated as a TOC', () => {
  assert.equal(findPrintedContentsEntries([fragment('See page 14',60,80),fragment('Chapter 2',60,120)], viewport).length,0);
  assert.equal(findPrintedContentsEntries([heading,fragment('See page 14',60,130)], viewport).length,0);
});

test('outline destinations take priority over physical page offsets', async () => {
  const options = {numPages: 100, pageLabels: null, outline: [{ title: 'I. Introduction',dest: [5] }], resolveOutlinePage: async () => 6};
  assert.equal(await resolvePrintedContentsPage({title:'I. Introduction',label:'1'}, options),6);
});

test('PDF page labels resolve roman front matter and numeric labels', async () => {
  const options = {numPages: 8, pageLabels: ['i','ii','iii','1','2','3','4','5'],outline:[],resolveOutlinePage: async () => null};
  assert.equal(await resolvePrintedContentsPage({title:'Preface',label:'iii'},options),3);
  assert.equal(await resolvePrintedContentsPage({title:'Introduction',label:'2'},options),5);
  assert.equal(await resolvePrintedContentsPage({title:'Out of bounds',label:'300'},options),null);
});

test('existing PDF links keep their own annotation handling', () => {
  const entry = {left: 60,top: 115,width: 200,height: 18};
  assert.equal(contentsEntryHasEmbeddedLink(entry,[{subtype:'Link',rect:[60,663,260,685]}],viewport),true);
  assert.equal(contentsEntryHasEmbeddedLink(entry,[{subtype:'Text',rect:[60,663,260,685]}],viewport),false);
});

test('embedded link overlap uses the installed PDF.js viewport API at every rotation', async () => {
  const loading = getDocument({
    data: new Uint8Array(readFileSync(new URL('./fixtures/footnote-columns-and-pages.pdf', import.meta.url))),
  });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    for (const rotation of [0, 90, 180, 270]) {
      const actualViewport = page.getViewport({ scale: 1.5, rotation });
      assert.equal(actualViewport.convertToViewportRectangle, undefined);
      const [x, y] = actualViewport.convertToViewportPoint(160, 674);
      const entry = { left: x - 5, top: y - 5, width: 10, height: 10 };
      assert.equal(contentsEntryHasEmbeddedLink(entry, [{ subtype: 'Link', rect: [60, 663, 260, 685] }], actualViewport), true);
      assert.equal(contentsEntryHasEmbeddedLink(entry, [{ subtype: 'Link', rect: [10, 10, 20, 20] }], actualViewport), false);
    }
  } finally {
    await loading.destroy();
  }
});

test('viewer wires printed contents buttons into ordinary page navigation', () => {
  const viewer = readFileSync(new URL('../src/viewer/viewer.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/viewer/annotation-layer.css', import.meta.url), 'utf8');
  assert.match(viewer, /findPrintedContentsEntries\(textContent\.items, viewport\)/);
  assert.match(viewer, /contentsEntryHasEmbeddedLink\(entry, annotations, viewport\)/);
  assert.match(viewer, /goToPage\(targetPage\)/);
  assert.match(css, /\.printed-contents-link/);
});
