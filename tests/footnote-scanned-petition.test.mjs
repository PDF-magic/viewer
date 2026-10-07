import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { appendFootnotesForPage, footnotesForPage } from "../src/viewer/navigation/footnote-index.js";

// Unenhanced PDF.js text and separator geometry from the SEC's original
// stapetition080409.pdf. Several printed labels have no text item at all.
const pages = JSON.parse(readFileSync(new URL("./fixtures/footnotes-sta-petition.json", import.meta.url)));
const viewport = page => ({ width: page.width, height: page.height,
  convertToViewportPoint: (x, y) => [x, page.height - y] });
const operators = page => ({ fnArray: [], argsArray: page.rules.map(rule =>
  [null, [[0]], [rule.x, page.height - rule.y, rule.x + rule.width, page.height - rule.y]]) });

test("original scanned petition indexes all 28 notes without enhancement", () => {
  const notes = [];
  let previous;
  for (const page of pages) {
    const view = viewport(page);
    appendFootnotesForPage(notes, page.items, view, page.n, operators(page), undefined, previous);
    previous = { items: page.items, viewport: view };
  }
  assert.deepEqual(notes.map(note => note.number), Array.from({ length: 28 }, (_, index) => index + 1));
  assert.deepEqual(notes.map(note => note.pageNumber),
    [2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 5, 6, 7, 7, 8, 9, 9, 10, 11, 11, 12, 12, 13, 14, 14, 14, 15, 15]);
  assert.match(notes[0].text, /^15 V.S.c./);
  assert.match(notes[13].text, /Unless prohibited.*As is the case.*would not be allowed\./);
  assert.doesNotMatch(notes[13].text, /Pub\. L\./);
  assert.match(notes[25].text, /balance certificate.*limited participant transfer agents\./);
  assert.match(notes[27].text, /^See Approval Order at note 31\.$/);
  assert.ok(notes.every(note => !/BUSINESS/.test(note.text)));
  assert.ok(notes.every(note => note.highlightRegions.length &&
    note.highlightRegions.every(region => region.pageNumber === note.pageNumber && region.top < 0.92)));
});

test("unanchored punctuation below a rule does not establish a note sequence", () => {
  const page = pages[4];
  assert.deepEqual(footnotesForPage(page.items, viewport(page), page.n, page.rules), []);
});

test("tools-menu lookup uses the recovered document sequence for missing labels", async () => {
  const source = readFileSync(new URL("../src/viewer/navigation/footnote-jump.js", import.meta.url), "utf8");
  const context = vm.createContext({ appendFootnotesForPage,
    candidateForPage: () => undefined, pageCache: new Map(), lookupRequestId: 1 });
  vm.runInContext(source.slice(source.indexOf("async function pageData("), source.indexOf("function scrollToTarget(")), context);
  const pdf = { numPages: pages.length, async getPage(number) {
    const page = pages[number - 1];
    return { getTextContent: async () => ({ items: page.items }),
      getViewport: () => viewport(page), getOperatorList: async () => operators(page), cleanup() {} };
  } };
  const target = await context.findFootnoteTarget(pdf, 26, 1, 1);
  assert.equal(target.pageNumber, 14);
  assert.match(target.text, /balance certificate/);
});
