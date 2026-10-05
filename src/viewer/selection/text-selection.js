import { selectionLines } from "./selection-lines.js";

const textLayers = new Map();
let pointerDown = false;

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

document.addEventListener("pointerdown", () => {
  pointerDown = true;
});

document.addEventListener("mousedown", (event) => {
  const textLayer = event.target instanceof Element ? event.target.closest(".text-layer") : null;
  if (textLayer) {
    textLayer.classList.add("selecting");
  }
});

document.addEventListener("selectionchange", syncSelectingLayers);

document.addEventListener("pointerup", () => {
  pointerDown = false;
  resetAllTextLayers();
});

document.addEventListener("keyup", () => {
  if (!pointerDown) {
    resetAllTextLayers();
  }
});

window.addEventListener("blur", () => {
  pointerDown = false;
  resetAllTextLayers();
});

// Paint once per visual line; PDF spans can overlap, especially around italics.
let paintFrame = 0;
const selectionOverlays = new Map();
function paintSelection() {
  paintFrame = 0;
  for (const overlay of selectionOverlays.values()) overlay.remove();
  selectionOverlays.clear();
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return;
  for (const layer of textLayers.keys()) {
    if (!layer.isConnected) continue;
    const rectangles = [];
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (let index = 0; index < selection.rangeCount; index++) {
        const selected = selection.getRangeAt(index);
        if (!selected.intersectsNode(node)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (selected.startContainer === node) range.setStart(node, selected.startOffset);
        if (selected.endContainer === node) range.setEnd(node, selected.endOffset);
        rectangles.push(...Array.from(range.getClientRects(), rect => ({
          left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        })));
      }
    }
    const lines = selectionLines(rectangles);
    if (!lines.length) continue;
    const bounds = layer.getBoundingClientRect();
    const scaleX = layer.clientWidth / bounds.width;
    const scaleY = layer.clientHeight / bounds.height;
    const namespace = "http://www.w3.org/2000/svg";
    const overlay = document.createElementNS(namespace, "svg");
    overlay.classList.add("text-selection-overlay");
    overlay.setAttribute("aria-hidden", "true");
    const addRect = (left, top, right, bottom, radius = 2) => {
      const rect = document.createElementNS(namespace, "rect");
      rect.setAttribute("x", (left - bounds.left) * scaleX);
      rect.setAttribute("y", (top - bounds.top) * scaleY);
      rect.setAttribute("width", (right - left) * scaleX);
      rect.setAttribute("height", (bottom - top) * scaleY);
      rect.setAttribute("rx", radius);
      overlay.append(rect);
    };
    for (const line of lines) addRect(line.left, line.top, line.right, line.bottom);
    for (let index = 1; index < lines.length; index++) {
      const previous = lines[index - 1], current = lines[index];
      const left = Math.max(previous.left, current.left) + 2 / scaleX;
      const right = Math.min(previous.right, current.right) - 2 / scaleX;
      if (previous.bottom === current.top && right > left) {
        addRect(left, current.top - 2 / scaleY, right, current.top + 2 / scaleY, 0);
      }
    }
    layer.append(overlay);
    selectionOverlays.set(layer, overlay);
  }
}
function scheduleSelectionPaint() {
  if (!paintFrame) paintFrame = requestAnimationFrame(paintSelection);
}
document.addEventListener("selectionchange", scheduleSelectionPaint);
window.addEventListener("resize", scheduleSelectionPaint);
const selectionResizeObserver = new ResizeObserver(scheduleSelectionPaint);
selectionResizeObserver.observe(document.querySelector("#viewer"));
