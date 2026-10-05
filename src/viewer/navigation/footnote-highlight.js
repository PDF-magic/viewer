import { createHighlightGroup, createHighlightLayer } from "../highlight-regions.js";

let activeRegions = [];
let activeSearchResult = false;

function rotatedRegion(region, rotation) {
  const { left, top, width, height } = region;
  switch ((rotation + 360) % 360) {
    case 90: return { left: 1 - top - height, top: left, width: height, height: width };
    case 180: return { left: 1 - left - width, top: 1 - top - height, width, height };
    case 270: return { left: top, top: 1 - left - width, width: height, height: width };
    default: return { left, top, width, height };
  }
}

export function renderFootnoteHighlight(page, pageNumber, rotation) {
  page.querySelector(".footnote-highlight-layer")?.remove();
  const regions = activeRegions.filter((region) => region.pageNumber === pageNumber);
  if (!regions.length) return;
  const layer = createHighlightLayer("footnote-highlight-layer", 1, 1);
  const className = activeSearchResult ? "footnote-highlight footnote-search-result" : "footnote-highlight";
  layer.append(createHighlightGroup(regions.map(region => rotatedRegion(region, rotation)), className));
  page.append(layer);
}

export function highlightFootnote(target, pages, rotation) {
  activeRegions = target.highlightRegions || [];
  activeSearchResult = target.searchResult === true;
  for (const [index, page] of pages.entries()) {
    renderFootnoteHighlight(page, index + 1, rotation);
  }
}
