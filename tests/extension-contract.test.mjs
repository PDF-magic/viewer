import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");

test("PDF MIME integration retains the local handler and embeddable PDF support", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.deepEqual(manifest.mime_types_handler["application/pdf"], {
    handler_url: "src/viewer.html",
    can_embed: true,
  });
});

test("extension pages reject remote, inline and unsafe-eval executable code", () => {
  const policy = manifest.content_security_policy?.extension_pages;
  assert.ok(policy);
  assert.match(policy, /script-src\s+'self'/);
  assert.match(policy, /object-src\s+'self'/);
  assert.doesNotMatch(policy, /'unsafe-inline'|'unsafe-eval'|https?:\/\//i);
  for (const [, url] of markup.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    assert.doesNotMatch(url, /^(?:https?:)?\/\//i);
  }
});

test("page integrations execute only on declared HTTPS sites", () => {
  assert.deepEqual(manifest.content_scripts.map((script) => script.matches), [
    ["https://www.sec.gov/*"], ["https://chatgpt.com/*"],
  ]);
  for (const script of manifest.content_scripts) {
    for (const pattern of script.matches) assert.match(pattern, /^https:\/\//);
    for (const path of [...(script.js || []), ...(script.css || [])]) {
      assert.doesNotThrow(() => readFileSync(new URL("../" + path, import.meta.url)));
    }
  }
});

test("web-accessible resources are narrow, existing and site-scoped", () => {
  for (const group of manifest.web_accessible_resources || []) {
    assert.ok(group.resources.length > 0);
    for (const path of group.resources) {
      assert.ok(!path.includes("*"), "No broad web-accessible resource wildcard");
      assert.doesNotThrow(() => readFileSync(new URL("../" + path, import.meta.url)));
    }
    for (const pattern of group.matches) {
      assert.match(pattern, /^https:\/\/[^*]+\//, "Resources must be scoped to a site");
    }
  }
});

test("viewer exposes accessible labels for navigation, search and sharing", () => {
  for (const id of ["previous-page", "next-page", "page-number", "search-input",
    "search-next", "search-previous", "copy-file-url", "share-page", "tools-button"]) {
    const position = markup.indexOf('id="' + id + '"');
    assert.ok(position >= 0, "Missing control #" + id);
    const tag = markup.slice(markup.lastIndexOf("<", position), markup.indexOf(">", position) + 1);
    assert.match(tag, /aria-label="[^"]+"/, "Missing accessible label for #" + id);
  }
});
