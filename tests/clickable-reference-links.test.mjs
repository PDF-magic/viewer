import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  findClickableReferences, findWrittenUrlReferences, createClickableReferenceLayer, referenceClicksEnabled,
} from "../src/viewer/navigation/clickable-reference-links.js";

const viewport = {
  width: 600, height: 800,
  convertToViewportPoint: (x, y) => [x, 800 - y],
};
const heading = { title: "3.1 Evidence", reference: "3.1", item: { dest: [2] } };
const targets = new Map([["3.1", [heading]]]);

test("inferred text links are on by default, but an explicit opt-out persists", () => {
  assert.equal(referenceClicksEnabled(null), true);
  assert.equal(referenceClicksEnabled("true"), true);
  assert.equal(referenceClicksEnabled("false"), false);
});

test("explicit footnote, page and uniquely outlined section references are clickable", () => {
  const items = [{ str: "See supra note 7, page 12, and § 3.1 for details." }];
  const links = findClickableReferences(items, { pageCount: 25, sectionTargets: targets, viewport });
  assert.deepEqual(links.map((link) => [link.kind, link.number || link.label]), [
    ["footnote", 7], ["page", 12], ["section", "3.1"],
  ]);
  assert.ok(links.every((link) => link.itemIndex === 0 && link.end > link.start));
  assert.equal(links[2].item, heading.item);
});

test("unknown, ambiguous and grouped section references do not become misleading links", () => {
  const ambiguous = new Map([["3.1", [heading, { ...heading }]]]);
  const source = [{ str: "See section 3.1, section 9 and Sections 3.1, 4.2." }];
  const refs = findClickableReferences(source, { pageCount: 20, sectionTargets: ambiguous, viewport });
  assert.deepEqual(refs, []);
});

test("plain dates and out-of-range page numbers remain unlinked", () => {
  assert.deepEqual(findClickableReferences([{
    str: "Published October 8, 2026. See page 9999 and section 17.",
  }], { pageCount: 23, sectionTargets: new Map(), viewport }), []);
});

test("recognize a confirmed raised numeric footnote marker but not body numbers", () => {
  const body = { str: "Example text", transform: [1, 0, 0, 12, 10, 600], height: 12, width: 55 };
  const superscript = { str: "4", transform: [1, 0, 0, 7, 66, 605], height: 7, width: 4 };
  const plain = { str: "2026", transform: [1, 0, 0, 12, 72, 600], height: 12, width: 24 };
  const links = findClickableReferences([body, superscript, plain], { pageCount: 10, viewport });
  assert.deepEqual(links.map((r) => [r.kind, r.number, r.itemIndex]), [["footnote", 4, 1]]);
});

test("reference preference is in More PDF tools and only controls inferred links", () => {
  const markup = readFileSync(new URL("../src/viewer.html", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/viewer/viewer-settings.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/viewer/annotation-layer.css", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8");
  const footnotes = readFileSync(new URL("../src/viewer/navigation/footnote-jump.js", import.meta.url), "utf8");
  assert.match(markup, /id="tools-menu"[\s\S]*id="clickable-references"[^>]*checked/);
  assert.match(settings, /referenceClicksEnabled\(localStorage\.getItem\(CLICKABLE_REFERENCES_STORAGE_KEY\)\)/);
  assert.match(settings, /classList\.toggle\("clickable-references-disabled", !enabled\)/);
  assert.match(css, /html\.clickable-references-disabled \.clickable-reference-layer\s*\{\s*display: none/);
  assert.match(viewer, /createClickableReferenceLayer\(\{/);
  assert.match(footnotes, /pdf-viewer-inline-footnote-jump/);
  // Embedded PDF links are still handled by PDF.js, not by this preference.
  assert.match(viewer, /new AnnotationLayer\(\{/);
});

test("generated hyperlinks use the theme accent without restyling native PDF links", () => {
  const css = readFileSync(new URL("../src/viewer/annotation-layer.css", import.meta.url), "utf8");
  const hoverRules = [
    css.match(/\.printed-contents-link:hover\s*\{([^}]*)\}/)?.[1],
    css.match(/\.clickable-reference-link:hover\s*\{([^}]*)\}/)?.[1],
  ];
  const focusRules = [
    css.match(/\.printed-contents-link:focus-visible\s*\{([^}]*)\}/)?.[1],
    css.match(/\.clickable-reference-link:focus-visible\s*\{([^}]*)\}/)?.[1],
  ];
  for (const hover of hoverRules) {
    assert.ok(hover, "generated link hover styling must exist");
    assert.match(hover, /background:\s*color-mix\(in srgb, var\(--accent\) 14%, transparent\)/);
    assert.match(hover, /outline:\s*1px solid color-mix\(in srgb, var\(--accent\) 32%, transparent\)/);
  }
  for (const focus of focusRules) {
    assert.ok(focus, "generated link keyboard focus styling must exist");
    assert.match(focus, /outline:\s*2px solid var\(--accent\)/);
  }
  // Keep native PDF.js link annotations independent of the accent treatment.
  const nativeRule = css.match(/\.annotation-layer \.linkAnnotation\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(nativeRule, /--accent|color-mix|background|outline/);
});

test("plain HTTP and HTTPS text becomes an inferred link, with punctuation trimmed", () => {
  const cases = [
    ["Read https://example.org/report.pdf.", "https://example.org/report.pdf"],
    ["See (https://example.org/path_(v2)).", "https://example.org/path_(v2)"],
    ["Visit http://localhost:4173/docs?q=1&v=2, thanks.", "http://localhost:4173/docs?q=1&v=2"],
    ["See https://example.com/a#section-2!", "https://example.com/a#section-2"],
  ];
  for (const [text, expected] of cases) {
    const refs = findWrittenUrlReferences([{ str: text }]);
    assert.equal(refs.length, 1, text);
    assert.equal(refs[0].kind, "url");
    assert.equal(refs[0].url, expected);
    assert.equal(text.slice(refs[0].start, refs[0].end), expected);
  }
});

test("URL detection does not invent links from unsupported schemes or incomplete addresses", () => {
  const items = [{ str: "ftp://example.org javascript:alert(1) https:// http:// no-url" }];
  assert.deepEqual(findWrittenUrlReferences(items), []);
  assert.deepEqual(findWrittenUrlReferences([{ str: "prefixhttps://example.org" }]), []);
});

test("adjacent PDF.js text fragments can jointly form a URL", () => {
  const items = [
    { str: "Visit https://exa" },
    { str: "mple.org/docs" },
    { str: " for details.", hasEOL: true },
  ];
  const refs = findWrittenUrlReferences(items);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map(ref => [ref.itemIndex, ref.start, ref.end]), [
    [0, 6, 17], [1, 0, 13],
  ]);
  assert.ok(refs.every(ref => ref.url === "https://example.org/docs" && ref.urlId === refs[0].urlId));
  assert.deepEqual(
    findClickableReferences(items, { pageCount: 20, viewport }).filter(ref => ref.kind === "url"),
    refs,
  );
});

test("line breaks and distant text fragments do not extend a URL", () => {
  assert.equal(findWrittenUrlReferences([
    { str: "https://example.com", hasEOL: true },
    { str: "unrelated", hasEOL: true },
  ])[0].url, "https://example.com/");
  assert.equal(findWrittenUrlReferences([
    { str: "https://example.com", transform: [1, 0, 0, 12, 0, 300], height: 12, width: 115 },
    { str: "unrelated", transform: [1, 0, 0, 12, 250, 300], height: 12, width: 60 },
  ])[0].url, "https://example.com/");
});

test("written URLs render as secure anchors and never overlap native PDF links", () => {
  const previousDocument = globalThis.document;
  const previousNodeFilter = globalThis.NodeFilter;
  let currentSpan;
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = {
    createElement(tag) {
      return {
        tag, style: {}, children: [],
        append(child) { this.children.push(child); },
        setAttribute(name, value) { this[name] = value; },
        addEventListener() {},
      };
    },
    createTreeWalker(span) {
      currentSpan = span;
      let visited = false;
      return {
        nextNode() {
          if (visited) return null;
          visited = true;
          return { textContent: span.textContent };
        },
      };
    },
    createRange() {
      return {
        setStart() {},
        setEnd() {},
        getClientRects() { return [currentSpan.rect]; },
      };
    },
  };
  try {
    const text = "https://example.org/";
    const rect = { left: 30, top: 30, width: 120, height: 16, right: 150, bottom: 46 };
    const params = {
      pageElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 1000 }) },
      items: [{ str: text }], textDivs: [{ textContent: text, rect }],
      annotationsLayer: { querySelectorAll: () => [] },
      viewport, pageCount: 3, sectionTargets: new Map(),
      onNavigate: () => { throw new Error("URLs should use anchor navigation"); },
    };
    const layer = createClickableReferenceLayer(params);
    assert.equal(layer.children.length, 1);
    const link = layer.children[0];
    assert.equal(link.tag, "a");
    assert.equal(link.href, text);
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.className, "clickable-reference-link");
    assert.equal(link["aria-label"], "Open " + text);

    const nativeLayer = createClickableReferenceLayer({
      ...params,
      annotationsLayer: { querySelectorAll: () => [{ getClientRects: () => [rect] }] },
    });
    assert.equal(nativeLayer.children.length, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousNodeFilter === undefined) delete globalThis.NodeFilter;
    else globalThis.NodeFilter = previousNodeFilter;
  }
});
