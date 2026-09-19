import { pdfDocumentSessionReady } from "../pdf-document-session.js";
import {
  createThumbnailCacheKey,
  readThumbnailCache,
  writeThumbnailCache,
} from "./minimap-cache.js";

const viewer = document.querySelector("#viewer");
const minimapShell = document.querySelector("#minimap-shell");
const minimap = document.querySelector("#minimap");
const minimapPages = document.querySelector("#minimap-pages");
const minimapViewport = document.querySelector("#minimap-viewport");
const rotateLeftButton = document.querySelector("#rotate-left");
const rotateRightButton = document.querySelector("#rotate-right");
const minimapToggle = document.querySelector("#show-minimap");
const minimapModeButton = document.querySelector("#minimap-mode");
const minimapModeIcon = document.querySelector("#minimap-mode-icon");
const minimapSwapSideButton = document.querySelector("#minimap-swap-side");
const minimapCollapseButton = document.querySelector("#minimap-collapse");

const MINIMAP_STORAGE_KEY = "pdf-viewer-show-minimap";
const MINIMAP_MODE_STORAGE_KEY = "pdf-viewer-minimap-mode";
const MINIMAP_SIDE_STORAGE_KEY = "pdf-viewer-minimap-side";
const MINIMAP_COLLAPSED_STORAGE_KEY = "pdf-viewer-minimap-collapsed";
const MINIMAP_RENDER_CONCURRENCY = 4;
const MINIMAP_WHEEL_TRACK_SCALE = 0.55;
const MINIMAP_THUMBNAIL_WIDTH = 80;
const MINIMAP_THUMBNAIL_RENDER_WIDTH = 40;
const MINIMAP_STRIP_MAX_HEIGHT = 32767;
const WHEEL_LINE_HEIGHT = 16;
let syncFrame;
let dragging = false;
let dragOffset = 0;
let viewportHeight = 18;
let mapHeight = 0;
let mapOffset = 0;
let thumbnailDocument;
let thumbnailFingerprint;
let thumbnailGeneration = 0;
let thumbnailLoadGeneration = 0;
let thumbnailRotation = 0;
let thumbnailPreparationStarted = false;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function minimapEnabled() {
  return !document.documentElement.classList.contains("minimap-disabled");
}

function minimapCollapsed() {
  return document.documentElement.classList.contains("minimap-collapsed");
}

function minimapMode() {
  return document.documentElement.classList.contains("minimap-local") ? "local" : "overview";
}

function setMinimapAccessibility() {
  const interactive = minimapEnabled() && !minimapCollapsed();
  minimap.setAttribute("aria-hidden", String(!interactive));
  minimap.tabIndex = interactive ? 0 : -1;
  minimapShell?.setAttribute("data-collapsed", String(minimapCollapsed()));
}

function setMinimapEnabled(enabled, persist = true) {
  document.documentElement.classList.toggle("minimap-disabled", !enabled);
  minimapToggle.checked = enabled;
  setMinimapAccessibility();

  if (persist) {
    localStorage.setItem(MINIMAP_STORAGE_KEY, String(enabled));
  }

  if (enabled && !minimapCollapsed()) {
    scheduleSync();
  }

  window.dispatchEvent(new Event("resize"));
}

function setMinimapMode(mode, persist = true) {
  const local = mode === "local";
  document.documentElement.classList.toggle("minimap-local", local);
  minimapModeButton?.setAttribute("aria-pressed", String(local));
  if (minimapModeIcon) {
    minimapModeIcon.textContent = local ? "☷" : "▥";
  }
  if (minimapModeButton) {
    const label = local ? "Use full-document minimap" : "Use local page navigator";
    minimapModeButton.setAttribute("aria-label", label);
    minimapModeButton.title = label;
  }

  if (persist) {
    localStorage.setItem(MINIMAP_MODE_STORAGE_KEY, local ? "local" : "overview");
    window.dispatchEvent(new Event("resize"));
  }

  scheduleSync();
}

function setMinimapSide(side, persist = true) {
  const left = side === "left";
  document.documentElement.classList.toggle("minimap-left", left);
  if (minimapSwapSideButton) {
    const label = left ? "Move minimap to the right" : "Move minimap to the left";
    minimapSwapSideButton.setAttribute("aria-label", label);
    minimapSwapSideButton.title = label;
  }

  if (persist) {
    localStorage.setItem(MINIMAP_SIDE_STORAGE_KEY, left ? "left" : "right");
    window.dispatchEvent(new Event("resize"));
  }

  scheduleSync();
}

function setMinimapCollapsed(collapsed, persist = true) {
  document.documentElement.classList.toggle("minimap-collapsed", collapsed);
  if (minimapCollapseButton) {
    const label = collapsed ? "Expand minimap" : "Collapse minimap";
    minimapCollapseButton.setAttribute("aria-label", label);
    minimapCollapseButton.setAttribute("aria-expanded", String(!collapsed));
    minimapCollapseButton.title = label;
  }
  setMinimapAccessibility();

  if (persist) {
    localStorage.setItem(MINIMAP_COLLAPSED_STORAGE_KEY, String(collapsed));
    window.dispatchEvent(new Event("resize"));
  }

  if (!collapsed) {
    scheduleSync();
  }
}

function scheduleSync() {
  if (!minimapEnabled() || syncFrame) {
    return;
  }

  syncFrame = requestAnimationFrame(() => {
    syncFrame = undefined;
    syncMinimap();
  });
}

function ensureTiles(pages) {
  const existingTiles = Array.from(minimapPages.querySelectorAll(".minimap-page"));
  if (existingTiles.length === pages.length) {
    return existingTiles;
  }

  const fragment = document.createDocumentFragment();
  const tiles = pages.map((page) => {
    const tile = document.createElement("div");
    tile.className = "minimap-page";
    tile.dataset.page = page.dataset.page || "";
    fragment.append(tile);
    return tile;
  });

  minimapPages.replaceChildren(fragment);
  return tiles;
}

function documentMetrics() {
  const documentHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight, 1);
  const scrollMaximum = Math.max(documentHeight - window.innerHeight, 0);
  return { documentHeight, scrollMaximum };
}

function viewportTopFromScrollPosition() {
  const { scrollMaximum } = documentMetrics();
  const viewportTravel = Math.max(mapHeight - viewportHeight, 0);
  const scrollRatio = scrollMaximum > 0 ? window.scrollY / scrollMaximum : 0;
  return clamp(scrollRatio, 0, 1) * viewportTravel;
}

function syncMinimap() {
  if (!minimap || minimap.clientHeight === 0 || minimapCollapsed()) {
    return;
  }

  const pages = Array.from(viewer.querySelectorAll(".page"));
  const tiles = ensureTiles(pages);
  const trackHeight = minimap.clientHeight;
  const { scrollMaximum } = documentMetrics();

  const pageWidth = pages[0]?.getBoundingClientRect().width || 1;
  const thumbnailWidth = tiles[0]?.clientWidth || MINIMAP_THUMBNAIL_WIDTH;
  const widthScale = thumbnailWidth / pageWidth;
  const widthScaledHeights = pages.map((page) => page.getBoundingClientRect().height * widthScale);
  const widthScaledHeight = widthScaledHeights.reduce((total, height) => total + height, 0);
  const heightCompression =
    minimapMode() === "overview" && widthScaledHeight > trackHeight
      ? trackHeight / widthScaledHeight
      : 1;
  const scale = widthScale * heightCompression;
  const tileHeights = pages.map((page) => page.getBoundingClientRect().height * scale);
  const contentHeight = tileHeights.reduce((total, height) => total + height, 0);
  mapHeight = minimapMode() === "overview" ? Math.min(trackHeight, contentHeight) : contentHeight;

  const strip = minimapPages.querySelector(".minimap-strip");
  if (strip) {
    strip.style.height = `${mapHeight}px`;
  }

  const scrollRatio = scrollMaximum > 0 ? clamp(window.scrollY / scrollMaximum, 0, 1) : 0;
  let packedTop = 0;
  pages.forEach((page, index) => {
    const tile = tiles[index];
    const tileHeight = tileHeights[index];

    tile.style.top = `${packedTop}px`;
    tile.style.height = `${tileHeight}px`;
    packedTop += tileHeight;
  });

  viewportHeight = Math.min(
    Math.max(mapHeight, 0),
    Math.max(18, window.innerHeight * scale),
  );
  const viewportTravel = Math.max(mapHeight - viewportHeight, 0);
  const viewportTop = clamp(scrollRatio, 0, 1) * viewportTravel;
  const mapTravel = Math.max(mapHeight - trackHeight, 0);
  mapOffset =
    minimapMode() === "local"
      ? clamp(viewportTop + viewportHeight / 2 - trackHeight / 2, 0, mapTravel)
      : 0;

  minimapPages.style.transform = `translateY(${-mapOffset}px)`;
  minimapViewport.style.top = `${viewportTop - mapOffset}px`;
  minimapViewport.style.height = `${viewportHeight}px`;
  minimap.setAttribute("aria-valuemax", String(Math.round(scrollMaximum)));
  minimap.setAttribute("aria-valuenow", String(Math.round(window.scrollY)));
}

function waitForPageElements(expectedCount) {
  if (viewer.querySelectorAll(".page").length === expectedCount) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (viewer.querySelectorAll(".page").length !== expectedCount) {
        return;
      }

      observer.disconnect();
      resolve();
    });

    observer.observe(viewer, { childList: true });
  });
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function finishMinimapPreparation() {
  const root = document.documentElement;
  root.classList.add("minimap-ready");
  if (root.classList.contains("document-ready")) {
    requestAnimationFrame(() => root.classList.toggle("minimap-preparing", false));
  }
}

async function loadThumbnailDocument(loadGeneration) {
  const session = await pdfDocumentSessionReady;
  if (!session) {
    return;
  }

  if (loadGeneration !== thumbnailLoadGeneration || !minimapEnabled()) {
    return;
  }

  thumbnailDocument = session.document;
  thumbnailFingerprint = session.fingerprint;
  const generation = ++thumbnailGeneration;
  const cachedStripPromise = restoreCachedThumbnailStrip(generation);
  await waitForPageElements(thumbnailDocument.numPages);
  if (loadGeneration !== thumbnailLoadGeneration || !minimapEnabled()) {
    return;
  }
  scheduleSync();
  await renderAllThumbnails(generation, cachedStripPromise);
}

async function renderThumbnail(pageNumber, generation) {
  const page = await thumbnailDocument.getPage(pageNumber);
  if (generation !== thumbnailGeneration) {
    page.cleanup();
    return null;
  }

  const baseViewport = page.getViewport({ scale: 1, rotation: thumbnailRotation });
  const viewport = page.getViewport({
    scale: MINIMAP_THUMBNAIL_RENDER_WIDTH / Math.max(baseViewport.width, 1),
    rotation: thumbnailRotation,
  });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));

  try {
    await page.render({ canvasContext: context, viewport }).promise;
  } catch {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  page.cleanup();
  return generation === thumbnailGeneration ? canvas : null;
}

function cacheKey() {
  return thumbnailFingerprint
    ? createThumbnailCacheKey(thumbnailFingerprint, thumbnailRotation, MINIMAP_THUMBNAIL_RENDER_WIDTH)
    : null;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not encode minimap thumbnail")),
      "image/png",
    );
  });
}

async function canvasFromBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

function composeThumbnailStrip(thumbnails) {
  const sourceHeight = thumbnails.reduce((total, thumbnail) => total + thumbnail.height, 0);
  const heightScale = Math.min(1, MINIMAP_STRIP_MAX_HEIGHT / Math.max(sourceHeight, 1));
  const strip = document.createElement("canvas");
  const context = strip.getContext("2d", { alpha: false });
  strip.className = "minimap-strip";
  strip.width = MINIMAP_THUMBNAIL_RENDER_WIDTH;
  strip.height = Math.max(1, Math.round(sourceHeight * heightScale));
  context.fillStyle = "#fff";
  context.fillRect(0, 0, strip.width, strip.height);

  let sourceTop = 0;
  thumbnails.forEach((thumbnail) => {
    const top = Math.round(sourceTop * heightScale);
    sourceTop += thumbnail.height;
    const bottom = Math.round(sourceTop * heightScale);
    context.drawImage(thumbnail, 0, top, strip.width, Math.max(1, bottom - top));
  });
  return strip;
}

function attachThumbnailStrip(strip) {
  minimapPages.querySelector(".minimap-strip")?.remove();
  minimapPages.append(strip);
  strip.style.height = `${mapHeight}px`;
}

async function restoreCachedThumbnailStrip(generation) {
  const key = cacheKey();
  if (!key) {
    return null;
  }

  try {
    const blob = await readThumbnailCache(key, thumbnailDocument.numPages);
    if (!blob || generation !== thumbnailGeneration) {
      return null;
    }
    const strip = await canvasFromBlob(blob);
    strip.className = "minimap-strip";
    return strip;
  } catch {
    return null;
  }
}

async function cacheThumbnailStrip(strip) {
  const key = cacheKey();
  if (!key) {
    return;
  }

  try {
    const blob = await canvasToBlob(strip);
    await writeThumbnailCache(key, blob, thumbnailDocument.numPages);
  } catch {
    // Persistent caching is an optimization; rendering remains usable without it.
  }
}

async function renderAllThumbnails(preparedGeneration, preparedCachedStrip) {
  if (!thumbnailDocument || !minimapEnabled()) {
    return;
  }

  const generation = preparedGeneration ?? ++thumbnailGeneration;
  const pages = Array.from(viewer.querySelectorAll(".page"));
  if (pages.length !== thumbnailDocument.numPages) {
    return;
  }

  const tiles = ensureTiles(pages);
  const cachedStrip = await (
    preparedCachedStrip ?? restoreCachedThumbnailStrip(generation)
  );
  if (generation !== thumbnailGeneration || !minimapEnabled()) {
    return;
  }
  if (cachedStrip && generation === thumbnailGeneration) {
    attachThumbnailStrip(cachedStrip);
    scheduleSync();
    return;
  }

  const thumbnails = new Array(thumbnailDocument.numPages);
  let nextPageNumber = 1;

  // Render several thumbnails concurrently, but keep them off-DOM until the
  // complete minimap can appear with the document.
  async function renderNextThumbnail() {
    while (nextPageNumber <= thumbnailDocument.numPages) {
      const pageNumber = nextPageNumber;
      nextPageNumber += 1;
      const canvas = await renderThumbnail(pageNumber, generation);
      if (!canvas || generation !== thumbnailGeneration) {
        return;
      }

      thumbnails[pageNumber - 1] = canvas;
      await yieldToBrowser();
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MINIMAP_RENDER_CONCURRENCY, thumbnailDocument.numPages) },
      () => renderNextThumbnail(),
    ),
  );

  if (generation !== thumbnailGeneration) {
    return;
  }

  const strip = composeThumbnailStrip(thumbnails);
  attachThumbnailStrip(strip);
  scheduleSync();
  void cacheThumbnailStrip(strip);
}

function startThumbnailPreparation() {
  if (thumbnailPreparationStarted || !minimapEnabled() || window.innerWidth <= 700) {
    return;
  }

  thumbnailPreparationStarted = true;
  const loadGeneration = ++thumbnailLoadGeneration;
  void loadThumbnailDocument(loadGeneration)
    .catch(() => {
      if (loadGeneration === thumbnailLoadGeneration) {
        thumbnailPreparationStarted = false;
      }
    })
    .finally(finishMinimapPreparation);
}

function stopThumbnailPreparation() {
  thumbnailLoadGeneration += 1;
  thumbnailGeneration += 1;
  thumbnailPreparationStarted = false;
  minimapPages.replaceChildren();
  thumbnailDocument = undefined;
  thumbnailFingerprint = undefined;
}

function rerenderThumbnails(delta) {
  thumbnailRotation = (thumbnailRotation + delta + 360) % 360;
  if (thumbnailDocument) {
    void renderAllThumbnails();
  }
}

function scrollFromViewportTop(viewportTop) {
  const { scrollMaximum } = documentMetrics();
  const viewportTravel = Math.max(mapHeight - viewportHeight, 0);
  const ratio = viewportTravel > 0 ? clamp(viewportTop / viewportTravel, 0, 1) : 0;
  window.scrollTo({ top: ratio * scrollMaximum, behavior: "auto" });
}

function normalizedWheelDelta(event) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * WHEEL_LINE_HEIGHT;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * minimap.clientHeight;
  }

  return event.deltaY;
}

function pointerPosition(event) {
  const rect = minimap.getBoundingClientRect();
  return clamp(event.clientY - rect.top, 0, rect.height);
}

function pointerMapPosition(event) {
  return pointerPosition(event) + mapOffset;
}

minimap.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

  const y = pointerMapPosition(event);
  const currentTop = viewportTopFromScrollPosition();
  const currentBottom = currentTop + viewportHeight;

  dragging = true;
  dragOffset = y >= currentTop && y <= currentBottom ? y - currentTop : viewportHeight / 2;
  minimap.setPointerCapture(event.pointerId);
  scrollFromViewportTop(y - dragOffset);
  event.preventDefault();
});

minimap.addEventListener("pointermove", (event) => {
  if (!dragging) {
    return;
  }

  scrollFromViewportTop(pointerMapPosition(event) - dragOffset);
});

function endDrag(event) {
  if (!dragging) {
    return;
  }

  dragging = false;
  if (minimap.hasPointerCapture(event.pointerId)) {
    minimap.releasePointerCapture(event.pointerId);
  }
}

minimap.addEventListener("pointerup", endDrag);
minimap.addEventListener("pointercancel", endDrag);

minimap.addEventListener(
  "wheel",
  (event) => {
    const delta = normalizedWheelDelta(event);
    if (!delta) {
      return;
    }

    const viewportTop = viewportTopFromScrollPosition();
    scrollFromViewportTop(viewportTop + delta * MINIMAP_WHEEL_TRACK_SCALE);
    event.preventDefault();
  },
  { passive: false },
);

minimap.addEventListener("keydown", (event) => {
  const pageStep = Math.max(window.innerHeight - 80, 120);
  let target;

  if (event.key === "ArrowUp") {
    target = window.scrollY - 60;
  } else if (event.key === "ArrowDown") {
    target = window.scrollY + 60;
  } else if (event.key === "PageUp") {
    target = window.scrollY - pageStep;
  } else if (event.key === "PageDown") {
    target = window.scrollY + pageStep;
  } else if (event.key === "Home") {
    target = 0;
  } else if (event.key === "End") {
    target = documentMetrics().scrollMaximum;
  } else {
    return;
  }

  window.scrollTo({ top: target, behavior: "auto" });
  event.preventDefault();
});

rotateLeftButton?.addEventListener("click", () => rerenderThumbnails(-90));
rotateRightButton?.addEventListener("click", () => rerenderThumbnails(90));
minimapModeButton?.addEventListener("click", () => {
  setMinimapMode(minimapMode() === "overview" ? "local" : "overview");
});
minimapSwapSideButton?.addEventListener("click", () => {
  setMinimapSide(document.documentElement.classList.contains("minimap-left") ? "right" : "left");
});
minimapCollapseButton?.addEventListener("click", () => {
  setMinimapCollapsed(!minimapCollapsed());
});
minimapToggle.addEventListener("change", () => {
  setMinimapEnabled(minimapToggle.checked);
  if (minimapToggle.checked) {
    startThumbnailPreparation();
  } else {
    stopThumbnailPreparation();
  }
});

const storedMinimapPreference = localStorage.getItem(MINIMAP_STORAGE_KEY);
const storedMinimapMode = localStorage.getItem(MINIMAP_MODE_STORAGE_KEY);
const storedMinimapSide = localStorage.getItem(MINIMAP_SIDE_STORAGE_KEY);
const storedMinimapCollapsed = localStorage.getItem(MINIMAP_COLLAPSED_STORAGE_KEY);
setMinimapMode(storedMinimapMode === "local" ? "local" : "overview", false);
setMinimapSide(storedMinimapSide === "left" ? "left" : "right", false);
setMinimapCollapsed(storedMinimapCollapsed === "true", false);
setMinimapEnabled(storedMinimapPreference !== "false", false);

if (!minimapEnabled() || window.innerWidth <= 700) {
  finishMinimapPreparation();
}

const mutationObserver = new MutationObserver(scheduleSync);
mutationObserver.observe(viewer, { childList: true, subtree: true });

const resizeObserver = new ResizeObserver(scheduleSync);
resizeObserver.observe(viewer);

window.addEventListener("scroll", scheduleSync, { passive: true });
window.addEventListener("resize", () => {
  scheduleSync();
  startThumbnailPreparation();
});
window.addEventListener("pagehide", () => {
  thumbnailLoadGeneration += 1;
  thumbnailGeneration += 1;
  thumbnailDocument = undefined;
  thumbnailFingerprint = undefined;
});

scheduleSync();
startThumbnailPreparation();
