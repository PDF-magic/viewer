import { footnotesForPage } from "./footnote-index.js";
import { findExplicitSectionReferences } from "./section-cross-references.js";

// This controls inferred text links only. The PDF's own link annotations, and
// explicit navigation tools, are never disabled by this preference.
export function referenceClicksEnabled(saved) {
  return saved !== "false";
}

const FOOTNOTE_REFERENCE = /\b(?:footnotes?|notes?|nn?\.)\s*#?\s*(\d{1,4})\b/gi;
const PAGE_REFERENCE = /\b(?:pages?|pp?\.)\s+(\d{1,5})\b/gi;

function superscriptMarker(items, index, viewport) {
  const item = items[index];
  const previous = items[index - 1];
  if (!previous?.str?.trim() || previous.hasEOL ||
      !/^\d{1,3}$/.test(item?.str?.trim() || "") ||
      !Array.isArray(item.transform) || !Array.isArray(previous.transform)) return null;

  const size = Math.abs(item.height || item.transform[3] || 0);
  const bodySize = Math.abs(previous.height || previous.transform[3] || 0);
  const rise = item.transform[5] - previous.transform[5];
  const gap = item.transform[4] - (previous.transform[4] + (previous.width || 0));
  const position = viewport?.convertToViewportPoint?.(item.transform[4], item.transform[5]);
  if (!(bodySize > 0 && size > 0 && size < bodySize * 0.83 &&
    rise > bodySize * 0.12 && rise < bodySize &&
    gap > -bodySize * 0.3 && gap < bodySize * 1.5 &&
    position && position[1] > viewport.height * 0.06 &&
    position[1] < viewport.height * 0.84)) return null;

  return { itemIndex: index, start: 0, end: item.str.length,
    kind: "footnote", number: Number(item.str.trim()) };
}

// Visible web addresses in a PDF are not always annotated as hyperlinks.
// Detect only HTTP(S) URLs; never execute schemes embedded in document text.
const WRITTEN_URL = /https?:\/\/[^\s<>"“”‘’]+/gi;

function trimWrittenUrl(value) {
  let result = value;
  while (result.length) {
    const last = result.at(-1);
    if (/[.,;:!?'"\u2019\u201d}]/.test(last)) {
      result = result.slice(0, -1);
    } else if (last === ")" || last === "]") {
      const opening = last === ")" ? "(" : "[";
      const opens = [...result].filter(char => char === opening).length;
      const closes = [...result].filter(char => char === last).length;
      if (closes <= opens) break; // Keep balanced parentheses in URL paths.
      result = result.slice(0, -1);
    } else {
      break;
    }
  }
  return result;
}

function separateTextRuns(previous, current) {
  if (!Array.isArray(previous?.transform) || !Array.isArray(current?.transform)) return false;
  const size = Math.max(Math.abs(previous.height || 0), Math.abs(current.height || 0), 2);
  if (Math.abs(previous.transform[5] - current.transform[5]) > size * 0.6) return true;
  // PDF.js sometimes omits an intervening space from adjacent text items.
  // Do not combine a URL with a visually separated word or column.
  return typeof previous.width === "number" &&
    current.transform[4] - (previous.transform[4] + previous.width) > Math.max(2, size * 0.4);
}

export function findWrittenUrlReferences(items = []) {
  const references = [];
  let run = "";
  let pieces = [];
  let urlId = 0;

  function flush() {
    for (const match of run.matchAll(WRITTEN_URL)) {
      // Reject embedded scheme-like substrings within an ordinary word.
      if (match.index > 0 && /[\p{L}\p{N}_@]/u.test(run[match.index - 1])) continue;
      const text = trimWrittenUrl(match[0]);
      if (!text || text.length > 2048) continue;
      let url;
      try {
        const parsed = new URL(text);
        if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) continue;
        url = parsed.href;
      } catch {
        continue;
      }
      const end = match.index + text.length;
      const id = urlId++;
      for (const piece of pieces) {
        const start = Math.max(match.index, piece.start);
        const stop = Math.min(end, piece.end);
        if (start < stop) references.push({
          kind: "url", url, urlId: id, itemIndex: piece.itemIndex,
          start: start - piece.start, end: stop - piece.start,
        });
      }
    }
    run = "";
    pieces = [];
  }

  for (const [itemIndex, item] of (items || []).entries()) {
    if (typeof item?.str !== "string") {
      flush();
      continue;
    }
    const previous = pieces.length ? items[pieces.at(-1).itemIndex] : null;
    if (previous && (previous.hasEOL || separateTextRuns(previous, item))) flush();
    const start = run.length;
    run += item.str;
    pieces.push({ itemIndex, start, end: run.length });
    if (item.hasEOL || run.length > 16384) flush();
  }
  flush();
  return references;
}

export function findClickableReferences(items, { pageCount, sectionTargets = new Map(), viewport } = {}) {
  const matches = [];
  // Index confirmed note labels so ordinary body numbers remain selectable.
  const labels = new Map((viewport ? footnotesForPage(items || [], viewport, 1) : [])
    .filter(note => note.markerItemIndex >= 0)
    .map(note => [note.markerItemIndex, note]));
  const urlReferencesByItem = new Map();
  for (const url of findWrittenUrlReferences(items)) {
    if (!urlReferencesByItem.has(url.itemIndex)) urlReferencesByItem.set(url.itemIndex, []);
    urlReferencesByItem.get(url.itemIndex).push(url);
  }
  for (const [itemIndex, item] of (items || []).entries()) {
    const content = item?.str;
    if (typeof content !== "string") continue;
    const candidates = [...(urlReferencesByItem.get(itemIndex) || [])];
    const note = labels.get(itemIndex);
    const label = note && content.match(/^\s*(?:\[\s*\d+\s*\]|\(\s*\d+\s*\)|\d+[.)]?)(?=\s|$)/);
    if (label) candidates.push({ itemIndex, start: 0, end: label[0].length,
      kind: "footnote", number: note.number });

    for (const match of content.matchAll(FOOTNOTE_REFERENCE)) {
      const number = Number(match[1]);
      if (number > 0) candidates.push({
        itemIndex, start: match.index, end: match.index + match[0].length,
        kind: "footnote", number,
      });
    }
    for (const match of content.matchAll(PAGE_REFERENCE)) {
      const number = Number(match[1]);
      if (number >= 1 && number <= pageCount) candidates.push({
        itemIndex, start: match.index, end: match.index + match[0].length,
        kind: "page", number,
      });
    }
    // Only make unique outlined sections clickable. Unresolved or ambiguous
    // section references remain selectable text, not misleading fake links.
    const sectionMatches = findExplicitSectionReferences(content);
    const starts = new Map();
    for (const match of sectionMatches) {
      if (!starts.has(match.start)) starts.set(match.start, []);
      starts.get(match.start).push(match);
    }
    for (const group of starts.values()) {
      if (group.length !== 1) continue; // One link must not conceal several destinations.
      const reference = group[0];
      const targets = sectionTargets.get(reference.normalizedReference) || [];
      if (targets.length === 1) candidates.push({
        itemIndex, start: reference.start, end: reference.end,
        kind: "section", item: targets[0].item, label: reference.reference,
      });
    }
    const marker = superscriptMarker(items, itemIndex, viewport);
    if (marker) candidates.push(marker);

    // Avoid redundant, overlapping click targets on the same text span.
    for (const candidate of candidates.sort((a, b) => a.start - b.start || b.end - a.end)) {
      if (candidate.end > content.length || candidate.start < 0) continue;
      if (matches.some((match) => match.itemIndex === itemIndex &&
        candidate.start < match.end && match.start < candidate.end)) continue;
      matches.push(candidate);
    }
  }
  return matches;
}

function overlap(a, b) {
  return a.left < b.right && b.left < a.right &&
    a.top < b.bottom && b.top < a.bottom;
}

function textRange(span, start, end) {
  // Search highlighting may split a PDF.js text span into marks and text nodes.
  // Map source offsets across all descendants instead of assuming one text node.
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0, began = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = offset + node.textContent.length;
    if (!began && start < next) {
      range.setStart(node, start - offset);
      began = true;
    }
    if (began && end <= next) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset = next;
  }
  return null;
}

// Buttons are laid directly over the matching PDF.js text glyphs. Unlike
// whole-line rectangles, they do not steal unrelated clicks or text selection.
export function createClickableReferenceLayer({
  pageElement, items, textDivs, annotationsLayer, viewport, pageCount,
  sectionTargets, onNavigate,
}) {
  const layer = document.createElement("div");
  layer.className = "clickable-reference-layer";
  const pageRect = pageElement.getBoundingClientRect();
  if (!(pageRect.width > 0 && pageRect.height > 0)) return layer;

  const nativeLinks = Array.from(annotationsLayer.querySelectorAll(".linkAnnotation a"))
    .flatMap((anchor) => Array.from(anchor.getClientRects()));
  const references = findClickableReferences(items, { pageCount, sectionTargets, viewport });
  const placements = [];
  const nativeUrlIds = new Set();
  for (const ref of references) {
    const span = textDivs[ref.itemIndex];
    if (!span || span.textContent.length !== items[ref.itemIndex].str.length) continue;
    const range = textRange(span, ref.start, ref.end);
    if (!range) continue;
    const rects = Array.from(range.getClientRects());
    // If even part of a written URL already has an embedded PDF link,
    // leave the entire URL to the native annotation, including split spans.
    if (ref.kind === "url" && rects.some(rect => nativeLinks.some(link => overlap(rect, link)))) {
      nativeUrlIds.add(ref.urlId);
    }
    placements.push({ ref, rects });
  }
  for (const { ref, rects } of placements) {
    if (ref.kind === "url" && nativeUrlIds.has(ref.urlId)) continue;
    const title = ref.kind === "url" ? "Open " + ref.url :
      ref.kind === "section" ? "Jump to section " + ref.label :
      "Jump to " + (ref.kind === "page" ? "page " : "footnote ") + ref.number;
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0 || nativeLinks.some(link => overlap(rect, link))) continue;
      const left = Math.max(0, rect.left - pageRect.left);
      const top = Math.max(0, rect.top - pageRect.top);
      const width = Math.min(rect.width, pageRect.width - left);
      const height = Math.min(rect.height, pageRect.height - top);
      if (width <= 0 || height <= 0) continue;
      const link = document.createElement(ref.kind === "url" ? "a" : "button");
      if (ref.kind === "url") {
        link.href = ref.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else {
        link.type = "button";
        link.addEventListener("click", () => onNavigate(ref));
      }
      link.className = "clickable-reference-link";
      link.style.left = (left / pageRect.width * 100) + "%";
      link.style.top = (top / pageRect.height * 100) + "%";
      link.style.width = (width / pageRect.width * 100) + "%";
      link.style.height = (height / pageRect.height * 100) + "%";
      link.title = title;
      link.setAttribute("aria-label", title);
      layer.append(link);
    }
  }
  return layer;
}
