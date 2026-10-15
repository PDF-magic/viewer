import { selectionLines } from "./selection-lines.js";
import { regionPaths } from "../highlight-regions.js";

const textLayers = new Map();
let pointerDown = false;
let selectionDragLayer = null;
let endpointFrame = 0;
let endpointPosition = null;
let paintFrame = 0;
const selectionOverlays = new Map();

function textLayersInNode(node) {
  if (!(node instanceof Element)) {
    return [];
  }

  const layers = [];
  if (node.matches(".text-layer")) {
    layers.push(node);
  }
  layers.push(...node.querySelectorAll(".text-layer"));
  return layers;
}

function resetTextLayer(textLayer, endOfContent) {
  if (!textLayer.isConnected) {
    textLayers.delete(textLayer);
    return;
  }

  textLayer.append(endOfContent);
  endOfContent.style.width = "";
  endOfContent.style.height = "";
  endOfContent.style.userSelect = "";
  textLayer.classList.remove("selecting");
}

function resetAllTextLayers() {
  for (const [textLayer, endOfContent] of textLayers) {
    resetTextLayer(textLayer, endOfContent);
  }
}

function registerTextLayer(textLayer) {
  if (textLayers.has(textLayer)) {
    return;
  }

  const endOfContent = document.createElement("div");
  endOfContent.className = "text-selection-end";
  endOfContent.setAttribute("aria-hidden", "true");
  textLayer.append(endOfContent);
  textLayers.set(textLayer, endOfContent);
  scheduleSelectionPaint();
}

function unregisterTextLayer(textLayer) {
  textLayers.delete(textLayer);
}

function syncSelectingLayers() {
  if (!pointerDown) {
    resetAllTextLayers();
    return;
  }

  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    resetAllTextLayers();
    return;
  }

  const activeLayers = new Set();

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);

    for (const textLayer of textLayers.keys()) {
      if (!textLayer.isConnected || activeLayers.has(textLayer)) {
        continue;
      }

      try {
        if (range.intersectsNode(textLayer)) {
          activeLayers.add(textLayer);
        }
      } catch {
        // Ignore ranges whose nodes are being replaced during a rerender.
      }
    }
  }

  for (const [textLayer, endOfContent] of textLayers) {
    if (activeLayers.has(textLayer)) {
      textLayer.classList.add("selecting");
    } else {
      resetTextLayer(textLayer, endOfContent);
    }
  }
}

for (const textLayer of document.querySelectorAll(".text-layer")) {
  registerTextLayer(textLayer);
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      for (const textLayer of textLayersInNode(node)) {
        registerTextLayer(textLayer);
      }
    }

    for (const node of mutation.removedNodes) {
      for (const textLayer of textLayersInNode(node)) {
        unregisterTextLayer(textLayer);
      }
    }
  }
});

observer.observe(document.querySelector("#viewer"), {
  childList: true,
  subtree: true,
});

document.addEventListener("pointerdown", (event) => {
  pointerDown = true;
  selectionDragLayer = event.target instanceof Element ? event.target.closest(".text-layer") : null;
});

// Chromium can resolve a drag into trailing whitespace to a later paragraph
// in an absolutely positioned PDF text layer. Use the nearby line's own edge.
function settleLineEndpoint() {
  endpointFrame = 0;
  if (!selectionDragLayer?.isConnected || !endpointPosition) return;
  const { x, y } = endpointPosition;
  const hit = document.elementFromPoint(x, y);
  if (hit !== selectionDragLayer && !hit?.classList.contains("text-selection-end")) return;
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selectionDragLayer.contains(selection.anchorNode)) return;
  const walker = document.createTreeWalker(selectionDragLayer, NodeFilter.SHOW_TEXT);
  let closest = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.length) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (!rect.width || y < rect.top || y > rect.bottom) continue;
      const distance = Math.max(rect.left - x, x - rect.right, 0);
      if (distance > 0 && (!closest || distance < closest.distance)) {
        closest = { node, distance, offset: x < rect.left ? 0 : node.textContent.length };
      }
    }
  }
  if (closest) selection.extend(closest.node, closest.offset);
}

document.addEventListener("pointermove", (event) => {
  if (!pointerDown || !selectionDragLayer) return;
  endpointPosition = { x: event.clientX, y: event.clientY };
  if (!endpointFrame) endpointFrame = requestAnimationFrame(settleLineEndpoint);
});

document.addEventListener("mousedown", (event) => {
  const textLayer = event.target instanceof Element ? event.target.closest(".text-layer") : null;
  if (textLayer) {
    textLayer.classList.add("selecting");
  }
});

document.addEventListener("selectionchange", syncSelectingLayers);

document.addEventListener("pointerup", (event) => {
  if (endpointFrame) cancelAnimationFrame(endpointFrame);
  endpointPosition = { x: event.clientX, y: event.clientY };
  settleLineEndpoint();
  pointerDown = false;
  selectionDragLayer = null;
  endpointPosition = null;
  resetAllTextLayers();
});

document.addEventListener("keyup", () => {
  if (!pointerDown) {
    resetAllTextLayers();
  }
});

window.addEventListener("blur", () => {
  pointerDown = false;
  selectionDragLayer = null;
  endpointPosition = null;
  if (endpointFrame) cancelAnimationFrame(endpointFrame);
  endpointFrame = 0;
  resetAllTextLayers();
});

// Paint once per visual line; PDF spans can overlap, especially around italics.
function paintSelection() {
  paintFrame = 0;
  for (const overlay of selectionOverlays.values()) overlay.remove();
  selectionOverlays.clear();
  for (const layer of textLayers.keys()) layer.classList.remove("selection-painted");
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return;
  for (const layer of textLayers.keys()) {
    if (!layer.isConnected) continue;
    const bounds = layer.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !layer.clientWidth || !layer.clientHeight) continue;
    const rectangles = [];
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (let index = 0; index < selection.rangeCount; index++) {
        const selected = selection.getRangeAt(index);
        // Rendering can replace range endpoints while pages enter/leave the
        // render window. Leave native highlighting visible if a range is stale.
        try {
          if (!selected.intersectsNode(node)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (range.compareBoundaryPoints(Range.START_TO_START, selected) < 0) {
            range.setStart(selected.startContainer, selected.startOffset);
          }
          if (range.compareBoundaryPoints(Range.END_TO_END, selected) > 0) {
            range.setEnd(selected.endContainer, selected.endOffset);
          }
          if (range.collapsed) continue;
          rectangles.push(...Array.from(range.getClientRects(), rect => ({
            left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          })));
        } catch {
          continue;
        }
      }
    }
    const lines = selectionLines(rectangles, 2);
    if (!lines.length) continue;
    const page = layer.parentElement;
    const source = page.querySelector("canvas:not(.page-image-overlay)");
    if (!source?.width || !source.height) continue;
    const scaleX = layer.clientWidth / bounds.width;
    const scaleY = layer.clientHeight / bounds.height;
    const namespace = "http://www.w3.org/2000/svg";
    const overlay = document.createElement("div");
    overlay.classList.add("text-selection-overlay");
    overlay.setAttribute("aria-hidden", "true");
    const paths = regionPaths(lines.map(line => ({
      left: (line.left - bounds.left) * scaleX,
      top: (line.top - bounds.top) * scaleY,
      width: (line.right - line.left) * scaleX,
      height: (line.bottom - line.top) * scaleY,
    })), 2);
    // Filter the rendered PDF ink, including scans, rather than redrawing OCR text.
    const surface = document.createElement("canvas");
    surface.width = source.width;
    surface.height = source.height;
    surface.getContext("2d").drawImage(source, 0, 0);
    surface.className = "text-selection-surface";
    surface.style.clipPath = `path("${paths.fill}")`;
    const tint = document.createElement("div");
    tint.className = "text-selection-tint";
    tint.style.clipPath = surface.style.clipPath;
    const frame = document.createElementNS(namespace, "svg");
    frame.setAttribute("viewBox", `0 0 ${layer.clientWidth} ${layer.clientHeight}`);
    frame.setAttribute("preserveAspectRatio", "none");
    const outline = document.createElementNS(namespace, "path");
    outline.setAttribute("d", paths.outline);
    frame.append(outline);
    overlay.append(surface, tint, frame);
    page.append(overlay);
    selectionOverlays.set(layer, overlay);
    layer.classList.add("selection-painted");
  }
}
function scheduleSelectionPaint() {
  if (!paintFrame) paintFrame = requestAnimationFrame(paintSelection);
}
document.addEventListener("selectionchange", scheduleSelectionPaint);
window.addEventListener("resize", scheduleSelectionPaint);
const selectionResizeObserver = new ResizeObserver(scheduleSelectionPaint);
selectionResizeObserver.observe(document.querySelector("#viewer"));
