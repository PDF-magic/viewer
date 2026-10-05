import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { footnotesForPage, footnoteContinuationForPage, appendFootnotesForPage } from "../src/viewer/navigation/footnote-index.js";

const source = readFileSync(new URL("../src/viewer/navigation/document-scrubber.js", import.meta.url), "utf8");
const viewport = { width: 600, height: 800, convertToViewportPoint: (x, y) => [x, y] };
const item = (str, height, x, y) => ({ str, height, transform: [1, 0, 0, height, x, y] });
const body = [item("Body text", 12, 60, 200), item("More body text", 12, 60, 300), item("Body continues", 12, 60, 400)];
const noteItems = [...body, item("7", 8, 60, 660), item("First note text", 8, 80, 660), item("Continued citation", 8, 60, 676), item("42 Second note text", 8, 60, 704), item("9", 10, 300, 760)];

test("index extracts note numbers and text, excluding footer page numbers", () => {
  const notes = footnotesForPage(noteItems, viewport, 9);
  assert.deepEqual(notes.map(({ number }) => number), [7, 42]);
  assert.equal(notes[0].text, "First note text Continued citation");
  assert.equal(notes[1].text, "Second note text");
  assert.equal(notes[1].pageNumber, 9);
});

test("ordinary numbered paragraphs and page counters do not create notes", () => {
  assert.deepEqual(footnotesForPage([...body, item("1 A numbered paragraph", 12, 60, 700), item("2", 10, 300, 760)], viewport, 2), []);
});

async function loadScrubber(pages, operators) {
  const elements = new Map();
  const jumps = [];
  const frames = [];
  const properties = {};
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: true, value: "1", clientWidth: 600, listeners: {}, attributes: {}, children: [],
      classList: { add() {}, remove() {} },
      contains(target) { return this.children.includes(target); },
      replaceChildren() { this.children = []; this.textContent = ""; },
      append(child) { this.children.push(child); },
      focus() { this.listeners.focus?.(); },
      style: { setProperty: (key, value) => { properties[key] = value; } },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      select() { this.selected = true; },
      blur() { this.listeners.blur?.(); },
      setCustomValidity(message) { this.validityMessage = message; },
      reportValidity() { this.reportedValidity = true; },
      getBoundingClientRect: () => ({ height: 28, width: 600, left: 0 }),
    });
    return elements.get(selector);
  }
  const context = vm.createContext({
    document: { createElement: () => element(Symbol()), querySelector: element, documentElement: element("root"), elementFromPoint: () => null },
    window: { addEventListener() {}, innerHeight: 800, innerWidth: 1000 },
    pdfDocumentSessionReady: Promise.resolve({ operators, document: {
      numPages: pages.length,
      getPage: async (number) => {
        const page = pages[number - 1];
        return {
          getTextContent: async () => ({ items: page.items || page }),
          getViewport: () => page.items ? { width: page.width, height: page.height,
            convertToViewportPoint: (x, y) => [x, page.height - y] } : viewport,
          getOperatorList: async () => page.operators || { argsArray: [] },
        };
      },
    } }),
    appendFootnotesForPage, scrollToTarget: (note) => jumps.push(note),
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    setTimeout: (callback) => { callback(); }, console,
  });
  vm.runInContext(source.replace(/^import .*$/gm, "").replace("void initializeScrubber();", "globalThis.ready = initializeScrubber();"), context);
  await context.ready;
  return { element, jumps, frames, properties };
}

test("scrubber stays hidden and reserves no space on documents without footnotes", async () => {
  const { element, properties } = await loadScrubber([body, body]);
  assert.equal(element("#document-scrubber").hidden, true);
  assert.equal(properties["--document-scrubber-height"], undefined);
});

test("slider counts note occurrences and navigates to their page and vertical position", async () => {
  const { element, jumps, frames, properties } = await loadScrubber([body, noteItems, body]);
  const range = element("#document-scrubber-range");
  assert.equal(element("#document-scrubber").hidden, false);
  assert.equal(range.max, "2");
  assert.equal(properties["--document-scrubber-height"], "28px");
  range.value = "2";
  range.listeners.input();
  while (frames.length) frames.shift()();
  assert.equal(jumps[0].number, 42);
  assert.equal(jumps[0].pageNumber, 2);
  assert.equal(jumps[0].yRatio, 704 / 800);
  assert.equal(element("#document-scrubber-current").value, "42");
  assert.match(element("#document-scrubber-preview").textContent, /Second note text/);
});

function realDocumentPages(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/footnotes-${name}.json`, import.meta.url), "utf8")).pages;
}

function indexFixture(page) {
  return footnotesForPage(page.items, {
    width: page.width, height: page.height,
    convertToViewportPoint: (x, y) => [x, page.height - y],
  }, page.pageNumber);
}

test("SEC news digest OCR addresses, decimals and dates are not footnotes", () => {
  for (const page of realDocumentPages("digest")) assert.deepEqual(indexFixture(page), []);
});

test("SEC comment letter keeps full-size note text and notes starting above midpage", () => {
  const pages = realDocumentPages("letter");
  assert.deepEqual(pages.map((page) => indexFixture(page).map((note) => note.number)), [[1], [4], [41, 42], [33, 34]]);
  const [note] = indexFixture(pages[1]);
  assert.ok(note.yRatio < 0.5);
  assert.match(note.text, /classification as a legacy transfer agent/);
  assert.match(note.text, /note 77/);
  assert.doesNotMatch(note.text, /Page 3 of 64/);
});


test("typing a displayed note number navigates by number, not slider index", async () => {
  const { element, jumps, frames } = await loadScrubber([body, noteItems]);
  const field = element("#document-scrubber-current");
  field.listeners.focus();
  assert.equal(field.selected, true);
  field.value = "42";
  field.listeners.keydown({ key: "Enter", preventDefault() {} });
  while (frames.length) frames.shift()();
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].number, 42);
  assert.equal(jumps[0].pageNumber, 2);
  assert.equal(element("#document-scrubber-range").value, "2");
});

test("invalid typed numbers stay editable and Escape restores the active number", async () => {
  const { element, jumps } = await loadScrubber([noteItems]);
  const field = element("#document-scrubber-current");
  field.listeners.focus();
  for (const value of ["", "999", "7oops", "7.5"]) {
    field.value = value;
    field.listeners.keydown({ key: "Enter", preventDefault() {} });
    assert.equal(jumps.length, 0);
    assert.ok(field.validityMessage);
    assert.equal(field.value, value);
  }
  field.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(field.value, "7");
  assert.equal(field.validityMessage, "");
});


test("note 33 joins apostrophes without adding spaces inside words", () => {
  const page = realDocumentPages("letter").find((page) => page.pageNumber === 46);
  const note = indexFixture(page).find((note) => note.number === 33);
  assert.match(note.text, /Commission’s efforts/);
  assert.match(note.text, /it’s important/);
  assert.doesNotMatch(note.text, /\s’|’\s/);
  assert.match(note.text, /review and prevent unauthorized/);
});


test("note 12 includes its unnumbered continuation on the next page without body text", () => {
  const pages = JSON.parse(readFileSync(new URL("./fixtures/footnote-continuation.json", import.meta.url), "utf8"));
  const note = indexFixture(pages[0]).find((note) => note.number === 12);
  assert.equal(note.continues, true);
  const page = pages[1];
  const viewport = { width: page.width, height: page.height, convertToViewportPoint: (x, y) => [x, page.height - y] };
  const continuation = footnoteContinuationForPage(page.items, viewport, page.operators, note, indexFixture(page));
  assert.match(continuation.text, /^implementation details involving/);
  assert.match(continuation.text, /issuer’s insider offering transactions\.$/);
  assert.doesNotMatch(continuation.text, /The present processing|Page 9 of 64|EDGAR Next Machine/);
  // A bottom-page paragraph remains eligible, but the next numbered note stops it.
  assert.equal(continuation.continues, true);
  assert.equal(footnoteContinuationForPage(page.items, viewport, { argsArray: [] }, note, []), null);
  const next = pages[2];
  assert.equal(footnoteContinuationForPage(next.items, { width: next.width, height: next.height, convertToViewportPoint: (x, y) => [x, next.height - y] }, next.operators, note, indexFixture(next)), null);
});

function federalRegisterFixture() {
  return JSON.parse(readFileSync(new URL("./fixtures/footnotes-federal-register.json", import.meta.url), "utf8"));
}

function appendFixture(index, page, operatorIds, referenceContext) {
  appendFootnotesForPage(index, page.items, {
    width: page.width, height: page.height,
    convertToViewportPoint: (x, y) => [x, page.height - y],
  }, page.pageNumber, page.operators, operatorIds, referenceContext);
}

test("Federal Register notes follow all three columns and exclude citation years", () => {
  const fixture = federalRegisterFixture();
  const notes = [];
  appendFixture(notes, fixture.pages[0], fixture.operatorIds);
  assert.deepEqual(notes.map((note) => note.number), Array.from({ length: 17 }, (_, i) => i + 1));
  assert.equal(notes[0].text, "See 85 FR 15576 (March 18, 2020).");
  assert.equal(notes[11].text, "See 12 U.S.C. 1467a(g)(1).");
  assert.match(notes[6].text, /results of the 2026 supervisory stress test/);
  assert.doesNotMatch(notes[6].text, /company treated as a bank holding/);
  assert.equal(notes[16].text, "12 U.S.C. 5365 note.");
});

test("a footnote continues into the next column and stops before its next marker", () => {
  const fixture = federalRegisterFixture();
  const notes = [];
  appendFixture(notes, fixture.pages[1], fixture.operatorIds);
  const note = notes.find((note) => note.number === 22);
  assert.equal(note.columnIndex, 0);
  assert.equal(note.endColumnIndex, 1);
  assert.match(note.text, /Stress Capital Buffer Requirements/);
  assert.match(note.text, /Those comments are addressed in a separate rulemaking/);
  assert.match(note.text, /FR-2025-0063-01\/comments\.$/);
  assert.doesNotMatch(note.text, /This commenter also noted/);
});

test("article dividers do not attach a new article to a completed footnote", () => {
  const fixture = federalRegisterFixture();
  const notes = [];
  appendFixture(notes, fixture.pages[2], fixture.operatorIds);
  const note = notes.find((note) => note.number === 10);
  assert.equal(note.text, "15 U.S.C. 78w(a)(2).");
  assert.equal(note.endColumnIndex, 0);
});

test("full-width tables above footnotes preserve the three-column note layout", () => {
  const fixture = federalRegisterFixture();
  const notes = [];
  appendFixture(notes, fixture.pages[3], fixture.operatorIds);
  assert.deepEqual(notes.map((note) => note.number), [3, 4, 5, 6, 7, 8, 9]);
});


test("notes beneath a full-width table retain references from the preceding page", () => {
  const fixture = federalRegisterFixture();
  const previous = fixture.pages.find((page) => page.pageNumber === 76);
  const page = fixture.pages.find((page) => page.pageNumber === 77);
  const notes = [];
  appendFixture(notes, page, fixture.operatorIds, { items: previous.items,
    viewport: { width: previous.width, height: previous.height, convertToViewportPoint: (x, y) => [x, previous.height - y] } });
  assert.deepEqual(notes.map((note) => note.number), [1, 2, 3, 4]);
  assert.match(notes[0].text, /^Impact and vibratory driving/);
  assert.match(notes[3].text, /tory driving and auger drilling\.$/);
  assert.doesNotMatch(notes[3].text, /This change is minor/);
});

test("full-width table note previews stop before the main article resumes", () => {
  const fixture = federalRegisterFixture();
  const notes = [];
  appendFixture(notes, fixture.pages.find((page) => page.pageNumber === 78), fixture.operatorIds);
  assert.deepEqual(notes.map((note) => note.number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(notes[0].text, /Committee on Taxonomy/);
  assert.match(notes[7].text, /harbor seal to be 2,832\.$/);
  assert.doesNotMatch(notes[7].text, /A detailed description/);
});

test("superscripts attached to table cell values are references, not additional notes", () => {
  const fixture = federalRegisterFixture();
  const notes = [];
  appendFixture(notes, fixture.pages.find((page) => page.pageNumber === 87), fixture.operatorIds);
  assert.deepEqual(notes.map((note) => note.number), [1, 2]);
  assert.match(notes[0].text, /within a relevant shutdown zone\.$/);
  assert.equal(notes[1].text, "Underwater noise would be truncated by land at approximately 13.9 km from Manchester Fuel Pier at its furthest distance.");
  assert.ok(notes.every((note) => !note.text.includes("21,544")));
});

test("release numbers on page 151 remain in the continued note, not the note index", () => {
  const fixture = federalRegisterFixture();
  const page = fixture.pages.find((page) => page.pageNumber === 151);
  const notes = [];
  appendFixture(notes, page, fixture.operatorIds);
  assert.deepEqual(notes.map((note) => note.number), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const continued = notes.find((note) => note.number === 5);
  assert.match(continued.text, /99098 \(Dec\. 6, 2023\)/);
  assert.match(continued.text, /99108 \(Dec\. 07, 2023\)/);
  const fallback = footnotesForPage(page.items, {
    width: page.width, height: page.height,
    convertToViewportPoint: (x, y) => [x, page.height - y],
  }, page.pageNumber);
  assert.ok(fallback.every((note) => ![2023, 9908, 99098, 99108].includes(note.number)));
});


test("repeated note numbers offer every occurrence and wait for a selection", async () => {
  const { element, jumps, frames } = await loadScrubber([noteItems, noteItems, noteItems]);
  const field = element("#document-scrubber-current");
  const preview = element("#document-scrubber-preview");
  field.listeners.focus();
  field.value = "7";
  field.listeners.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(jumps.length, 0);
  assert.equal(field.attributes["aria-expanded"], "true");
  assert.equal(preview.attributes.role, "group");
  assert.equal(preview.children.length, 4);
  assert.match(preview.children[3].textContent, /Page 3\nFirst note text/);
  // Moving focus into the popup must preserve the choices.
  field.listeners.blur({ relatedTarget: preview.children[3] });
  assert.equal(preview.children.length, 4);
  preview.children[3].listeners.click();
  while (frames.length) frames.shift()();
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].pageNumber, 3);
  assert.equal(jumps[0].number, 7);
  assert.equal(field.attributes["aria-expanded"], "false");
  assert.equal(preview.attributes.role, "tooltip");
});

test("editing or escaping repeated-number choices cancels without navigation", async () => {
  const { element, jumps } = await loadScrubber([noteItems, noteItems]);
  const field = element("#document-scrubber-current");
  const preview = element("#document-scrubber-preview");
  field.listeners.focus();
  field.value = "42";
  field.listeners.keydown({ key: "Enter", preventDefault() {} });
  field.value = "7";
  field.listeners.input();
  assert.equal(field.attributes["aria-expanded"], "false");
  field.value = "42";
  field.listeners.keydown({ key: "Enter", preventDefault() {} });
  preview.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(jumps.length, 0);
  assert.equal(field.attributes["aria-expanded"], "false");
  assert.equal(field.value, "7");
});

test("Federal Register repeated note 4 entries appear separately with their text", async () => {
  const fixture = federalRegisterFixture();
  const pages = fixture.pages.filter((page) => [77, 78, 151].includes(page.pageNumber));
  const { element, jumps, frames } = await loadScrubber(pages, fixture.operatorIds);
  const field = element("#document-scrubber-current");
  field.listeners.focus();
  field.value = "4";
  field.listeners.keydown({ key: "Enter", preventDefault() {} });
  const choices = element("#document-scrubber-preview").children.slice(1);
  assert.equal(choices.length, 3);
  assert.equal(new Set(choices.map((choice) => choice.textContent)).size, 3);
  assert.equal(jumps.length, 0);
  choices[1].listeners.click();
  while (frames.length) frames.shift()();
  assert.equal(jumps[0].number, 4);
  assert.equal(jumps[0].pageNumber, 2);
});
