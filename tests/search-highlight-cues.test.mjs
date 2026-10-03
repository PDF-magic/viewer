import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const searchCueSource = readFileSync(
  new URL("../src/viewer/search/search-highlight-cues.js", import.meta.url),
  "utf8",
);

test("active search results center the highlighted content", () => {
  assert.match(searchCueSource, /let lastScrolledMatchKey = "";/);
  assert.match(
    searchCueSource,
    /activeHighlight\.scrollIntoView\(\{[\s\S]*?behavior: "instant",[\s\S]*?block: "center",[\s\S]*?inline: "nearest",[\s\S]*?\}\);/,
  );
  assert.match(searchCueSource, /if \(scrollKey !== lastScrolledMatchKey\)/);
});
