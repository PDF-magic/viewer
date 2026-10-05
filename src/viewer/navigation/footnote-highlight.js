import { createHighlightGroup, createHighlightLayer } from "../highlight-regions.js";
import { selectionLines } from "../selection/selection-lines.js";

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
  const sideways = ((rotation + 360) % 180) === 90;
  const width = Math.max(1, sideways ? page.clientHeight : page.clientWidth);
  const height = Math.max(1, sideways ? page.clientWidth : page.clientHeight);
  const lines = selectionLines(regions.map(region => ({
    left: region.left * width, right: (region.left + region.width) * width,
    top: region.top * height, bottom: (region.top + region.height) * height,
  })));
  const connectedRegions = lines.map(line => ({
    left: line.left / width, top: line.top / height,
    width: (line.right - line.left) / width, height: (line.bottom - line.top) / height,
  }));
  const layer = createHighlightLayer("footnote-highlight-layer", 1, 1);
  const className = activeSearchResult ? "footnote-highlight footnote-search-result" : "footnote-highlight";
  layer.append(createHighlightGroup(connectedRegions.map(region => rotatedRegion(region, rotation)), className));
  page.append(layer);
}

export function highlightFootnote(target, pages, rotation) {
  activeRegions = target.highlightRegions || [];
  activeSearchResult = target.searchResult === true;
  for (const [index, page] of pages.entries()) {
    renderFootnoteHighlight(page, index + 1, rotation);
  }
}
