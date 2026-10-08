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

export function findClickableReferences(items, { pageCount, sectionTargets = new Map(), viewport } = {}) {
  const matches = [];
  for (const [itemIndex, item] of (items || []).entries()) {
    const content = item?.str;
    if (typeof content !== "string") continue;
    const candidates = [];

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
  for (const ref of references) {
    const span = textDivs[ref.itemIndex];
    if (!span || span.textContent.length !== items[ref.itemIndex].str.length) continue;
    const range = textRange(span, ref.start, ref.end);
    if (!range) continue;
    const title = ref.kind === "section" ? "Jump to section " + ref.label :
      "Jump to " + (ref.kind === "page" ? "page " : "footnote ") + ref.number;
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0 || nativeLinks.some((link) => overlap(rect, link))) continue;
      const left = Math.max(0, rect.left - pageRect.left);
      const top = Math.max(0, rect.top - pageRect.top);
      const width = Math.min(rect.width, pageRect.width - left);
      const height = Math.min(rect.height, pageRect.height - top);
      if (width <= 0 || height <= 0) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clickable-reference-link";
      button.style.left = (left / pageRect.width * 100) + "%";
      button.style.top = (top / pageRect.height * 100) + "%";
      button.style.width = (width / pageRect.width * 100) + "%";
      button.style.height = (height / pageRect.height * 100) + "%";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("click", () => onNavigate(ref));
      layer.append(button);
    }
  }
  return layer;
}
