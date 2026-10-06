import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8");

test("narrow viewer pages reach the horizontal viewport edges", () => {
  assert.match(
    styles,
    /@media \(max-width: 720px\)[\s\S]*?\.viewer\s*\{[\s\S]*?padding-inline:\s*0;[\s\S]*?\}[\s\S]*?\.page\s*\{[\s\S]*?width:\s*100%;[\s\S]*?border-radius:\s*0;[\s\S]*?\}/,
  );
});
