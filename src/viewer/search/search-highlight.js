import { findSearchMatches } from "./search-matches.js";
import { createHighlightGroup, createHighlightLayer } from "../highlight-regions.js";

const content = new WeakMap();

export function registerSearchText(textLayer, items, spans) {
  content.set(textLayer, { items, spans });
}

export function highlightTextLayer(textLayer, query) {
  const data = content.get(textLayer);
  if (!data) return;
  const page = textLayer.closest(".page");
  page?.querySelector(".search-highlight-layer")?.remove();
  const { items, spans } = data;
  spans.forEach((span, index) => span.replaceChildren(items[index].str));
  const matches = findSearchMatches(items, query);
  const byItem = new Map();
  for (const match of matches) {
    for (const range of match.ranges) {
      if (!byItem.has(range.itemIndex)) byItem.set(range.itemIndex, []);
      byItem.get(range.itemIndex).push({ ...range, ordinal: match.ordinal });
    }
  }
  for (const [index, ranges] of byItem) {
    if (!spans[index]) continue;
    const text = items[index].str;
    const fragment = document.createDocumentFragment();
    const boundaries = [...new Set([0, text.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const start = boundaries[i], end = boundaries[i + 1];
      const ordinals = ranges.filter(range => range.start < end && range.end > start).map(range => range.ordinal);
      if (!ordinals.length) {
        fragment.append(text.slice(start, end));
        continue;
      }
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.dataset.searchOrdinals = ordinals.join(" ");
      mark.textContent = text.slice(start, end);
      fragment.append(mark);
    }
    spans[index].replaceChildren(fragment);
  }
  if (!page || !matches.length) return;
  const pageRect = page.getBoundingClientRect();
  const layer = createHighlightLayer("search-highlight-layer", page.clientWidth, page.clientHeight);
  const rectangles = new Map();
  for (const mark of textLayer.querySelectorAll(".search-highlight")) {
    for (const ordinal of mark.dataset.searchOrdinals.split(" ")) {
      if (!rectangles.has(ordinal)) rectangles.set(ordinal, []);
      for (const rect of mark.getClientRects()) {
        rectangles.get(ordinal).push({
          left: rect.left - pageRect.left - page.clientLeft,
          top: rect.top - pageRect.top - page.clientTop,
          width: rect.width, height: rect.height,
        });
      }
    }
  }
  for (const [ordinal, rects] of rectangles) {
    const group = createHighlightGroup(rects, "search-highlight-group");
    group.dataset.searchOrdinal = ordinal;
    layer.append(group);
  }
  page.append(layer);
}
