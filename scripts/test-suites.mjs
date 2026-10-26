import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testDirectoryUrl = new URL("../tests/", import.meta.url);
const testDirectory = fileURLToPath(testDirectoryUrl);

// Explicit feature ownership: unlisted or multiply assigned tests fail CI.
export const suites = Object.freeze({
  "rendering": [
    "enhance-pdf.test.mjs",
    "enhancer-setup.test.mjs",
    "first-page-position.test.mjs",
    "highlight-regions.test.mjs",
    "initial-page.test.mjs",
    "loading-image-setting.test.mjs",
    "loading-screen.test.mjs",
    "page-previews.test.mjs",
    "page-resume.test.mjs",
    "pdf-source.test.mjs",
    "print-renderer.test.mjs",
    "render-window.test.mjs",
    "zoom-position.test.mjs"
  ],
  "navigation": [
    "document-scrubber.test.mjs",
    "minimap-cache.test.mjs",
    "minimap-position.test.mjs",
    "minimap.test.mjs",
    "page-jump.test.mjs",
    "page-number-input.test.mjs",
    "page-tab-labels.test.mjs",
    "printed-contents.test.mjs",
    "printed-page-jump.test.mjs",
    "rapid-page-navigation.test.mjs"
  ],
  "references": [
    "clickable-reference-links.test.mjs",
    "section-cross-references.test.mjs"
  ],
  "footnotes": [
    "footnote-click-copy.test.mjs",
    "footnote-continuation-pdf.test.mjs",
    "footnote-cross-references.test.mjs",
    "footnote-jump.test.mjs",
    "footnote-scanned-hearing.test.mjs",
    "footnote-scanned-petition.test.mjs"
  ],
  "search": [
    "search-empty-state.test.mjs",
    "search-highlight-cues.test.mjs",
    "search-matches.test.mjs",
    "search-navigation.test.mjs",
    "search-selected-text.test.mjs",
    "search-text-normalization.test.mjs",
    "search-url-wrapping.test.mjs"
  ],
  "selection": [
    "clipboard-fallback.test.mjs",
    "markdown-copy.test.mjs",
    "selection-gaps.test.mjs",
    "selection-lines.test.mjs",
    "tagged-paragraph-copy.test.mjs",
    "terminal-punctuation-selection.test.mjs"
  ],
  "document": [
    "document-reference-url.test.mjs",
    "document-title.test.mjs",
    "local-file-favicon.test.mjs",
    "metadata-date.test.mjs",
    "metadata-doi.test.mjs"
  ],
  "appearance": [
    "accent-color.test.mjs",
    "narrow-viewer-layout.test.mjs"
  ],
  "chatgpt": [
    "chatgpt-pdf-relay.test.mjs",
    "chatgpt-summary-popup.test.mjs"
  ],
  "security": [
    "extension-contract.test.mjs"
  ]
});

const present = (await readdir(testDirectory)).filter((name) => name.endsWith(".test.mjs")).sort();
const ownership = new Map(present.map((name) => [name, []]));
const missing = [];

for (const [suite, names] of Object.entries(suites)) {
  if (!names.length) throw new Error("Empty test suite: " + suite);
  for (const name of names) {
    if (!ownership.has(name)) missing.push(suite + ": " + name);
    else ownership.get(name).push(suite);
  }
}
const unowned = [...ownership].filter(([, owners]) => owners.length === 0).map(([name]) => name);
const duplicated = [...ownership].filter(([, owners]) => owners.length > 1).map(([name, owners]) => name + " (" + owners.join(", ") + ")");
if (missing.length || unowned.length || duplicated.length) {
  throw new Error([
    "Invalid CI feature test ownership:",
    ...missing.map((line) => "  missing: " + line),
    ...unowned.map((line) => "  unowned: " + line),
    ...duplicated.map((line) => "  duplicate: " + line),
  ].join("\n"));
}

const suite = process.argv[2] || "all";
if (suite === "--list") {
  for (const [name, files] of Object.entries(suites)) console.log(name.padEnd(12) + " " + files.length + " files");
  console.log("Total: " + present.length + " JavaScript test files; each belongs to exactly one suite.");
} else {
  if (suite !== "all" && !Object.hasOwn(suites, suite)) {
    throw new Error("Unknown suite '" + suite + "'. Expected: " + Object.keys(suites).join(", ") + ", all, or --list");
  }
  const selected = suite === "all" ? present : suites[suite];
  console.log("Running " + selected.length + " " + suite + " test files");
  const files = selected.map((name) => fileURLToPath(new URL(name, testDirectoryUrl)));
  const command = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
  if (command.error) throw command.error;
  if (command.signal) throw new Error("Node test runner terminated by " + command.signal);
  process.exitCode = command.status ?? 1;
}
