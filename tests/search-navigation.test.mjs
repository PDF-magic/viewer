import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewerSource = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");

test("search shows the active result and total result count", () => {
  assert.match(
    viewerSource,
    /searchCount\.textContent = `\$\{activeSearchIndex \+ 1\} \/ \$\{searchMatches\.length\}`;/,
  );
});

test("Enter advances to the next search result and Shift+Enter goes back", () => {
  assert.match(
    viewerSource,
    /searchInput\.addEventListener\("keydown", \(event\) => \{[\s\S]*?if \(event\.key === "Enter"\) \{[\s\S]*?stepSearch\(event\.shiftKey \? -1 : 1\);/,
  );
});
