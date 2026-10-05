import assert from "node:assert/strict";
import test from "node:test";
import { findSearchMatches } from "../src/viewer/search/search-matches.js";

test("multiline occurrences keep the source ranges for every matching line", () => {
  const items = [{ str: "Market structure", hasEOL: true }, { str: "reform continues." },
    { str: "Market structure reform" }];
  const matches = findSearchMatches(items, "structure\nreform");
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map(match => match.ordinal), [0, 1]);
  assert.deepEqual(matches[0].ranges, [
    { itemIndex: 0, start: 7, end: 16 }, { itemIndex: 1, start: 0, end: 6 },
  ]);
  assert.deepEqual(matches[1].ranges, [{ itemIndex: 2, start: 7, end: 23 }]);
});

test("normalization maps ligatures and collapsed whitespace to original text", () => {
  const items = [{ str: "The ofﬁce\t\t rules" }];
  const [match] = findSearchMatches(items, "OFFICE rules");
  const [range] = match.ranges;
  assert.equal(items[0].str.slice(range.start, range.end), "ofﬁce\t\t rules");
});

test("wrapped URLs highlight all source fragments", () => {
  const items = [{ str: "See https://example.com/", hasEOL: true }, { str: "long-" }, { str: "document.pdf" }];
  const [match] = findSearchMatches(items, "https://example.com/long-document.pdf");
  assert.deepEqual(match.ranges.map(range => items[range.itemIndex].str.slice(range.start, range.end)),
    ["https://example.com/", "long-", "document.pdf"]);
});

test("separate normalized matches can refer to the same original ligature", () => {
  const matches = findSearchMatches([{ str: "ﬀ" }], "f");
  assert.equal(matches.length, 2);
  assert.deepEqual(matches[0].ranges, matches[1].ranges);
});
