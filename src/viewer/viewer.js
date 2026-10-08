import { AnnotationLayer, createValidAbsoluteUrl, getDocument, GlobalWorkerOptions, OPS, TextLayer, VerbosityLevel } from "../../node_modules/pdfjs-dist/build/pdf.mjs";
import { EventBus, PDFLinkService } from "../../node_modules/pdfjs-dist/web/pdf_viewer.mjs";
import { abandonPdfDocumentSession, publishPdfDocument } from "./pdf-document-session.js";
import { referenceUrlFromPdfMetadata, resolveDocumentReferenceUrl } from "./document-reference-url.js";
import { resolvePdfSource } from "./pdf-source.js";
import { findSearchMatches } from "./search/search-matches.js";
import { highlightTextLayer, registerSearchText } from "./search/search-highlight.js";
import { normalizeSearchText } from "./search/search-text.js";
import { PagePreviews } from "./page-previews.js";
import { preparePrintDocument } from "./print-renderer.js";
import { highlightFootnote, renderFootnoteHighlight } from "./navigation/footnote-highlight.js";

const sourceMode = window.location.pathname.includes("/src/");

function extensionAssetUrl(sourcePath, builtPath) {
  return chrome.runtime.getURL(sourceMode ? sourcePath : builtPath);
}

GlobalWorkerOptions.workerSrc = extensionAssetUrl(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "pdf.worker.min.mjs",
);

const viewer = document.querySelector("#viewer");
const status = document.querySelector("#status");
const previousButton = document.querySelector("#previous-page");
const nextButton = document.querySelector("#next-page");
const pageNumberInput = document.querySelector("#page-number");
const pageCount = document.querySelector("#page-count");
const searchInput = document.querySelector("#search-input");
const searchControl = document.querySelector(".search-control");
const searchCount = document.querySelector("#search-count");
const searchFirstButton = document.querySelector("#search-first");
const searchPreviousButton = document.querySelector("#search-previous");
const searchNextButton = document.querySelector("#search-next");
const shareButton = document.querySelector("#share-page");
const shareIcon = document.querySelector("#share-icon");
const sectionNav = document.querySelector("#section-nav");
const sectionToggle = document.querySelector("#section-toggle");
const sectionPopover = document.querySelector("#section-popover");
const sectionDocumentTitle = document.querySelector("#section-document-title");
const sectionList = document.querySelector("#section-list");
const sectionMetadata = document.querySelector("#section-metadata");
const sectionMetadataList = document.querySelector("#section-metadata-list");
const themeButton = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const tools = document.querySelector("#tools");
const toolsButton = document.querySelector("#tools-button");
const toolsMenu = document.querySelector("#tools-menu");
const rotateLeftButton = document.querySelector("#rotate-left");
const rotateRightButton = document.querySelector("#rotate-right");
const printButton = document.querySelector("#print-pdf");
const downloadButton = document.querySelector("#download-pdf");
const toast = document.querySelector("#toast");

const THEME_STORAGE_KEY = "pdf-viewer-theme";
const LUNA_ICON = extensionAssetUrl("src/assets/luna-mark.png", "assets/luna-mark.png");
const CELESTIA_ICON = extensionAssetUrl("src/assets/celestia-mark.png", "assets/celestia-mark.png");
const DARK_MODE_SHARE_ICON = extensionAssetUrl(
  "src/assets/copy-page-icon.png",
  "assets/copy-page-icon.png",
);
const LIGHT_MODE_SHARE_ICON = extensionAssetUrl(
  "src/assets/copy-page-icon-light.png",
  "assets/copy-page-icon-light.png",
);
const SCANNED_PAGE_IMAGE_AREA_THRESHOLD = 0.8;
const RENDER_WINDOW_RADIUS = 3;
const PDF_METADATA_FIELDS = [
  ["Author", "Author", "dc:creator"],
  ["Subject", "Subject", "dc:description"],
  ["Keywords", "Keywords", "pdf:keywords"],
  ["Creator", "Creator", "xmp:creatortool"],
  ["Producer", "Producer", "pdf:producer"],
  ["Created", "CreationDate", "xmp:createdate"],
  ["Modified", "ModDate", "xmp:modifydate"],
];

let pdfDocument;
let pdfLinkService;
let originalUrl;
let requestUrl;
let fileName = "document.pdf";
let currentPage = 1;
let rotation = 0;
let pageElements = [];
let scrollFrame;
let toastTimer;
let mimeHandlerActive = false;
let searchTimer;
let searchRequestId = 0;
let completedSearchQuery = "";
let searchMatches = [];
let activeSearchIndex = -1;
let sectionEntries = [];
let sectionHighlightRequestId = 0;
let renderGeneration = 0;
let renderingAllPages = false;
let renderQueuePromise;
let pagePreviews;
let sharpRenderTimer;
const priorityRenderQueue = new Set();
const backgroundRenderQueue = new Set();
const renderedPages = new Set();
// Keep the previous bitmap on screen until a render at the new size is ready.
const staleRenderedPages = new Set();
const pageTextCache = new Map();

function imageAreaFraction(imageCoordinates, offset) {
  const topLeftX = imageCoordinates[offset];
  const topLeftY = imageCoordinates[offset + 1];
  const bottomLeftX = imageCoordinates[offset + 2];
  const bottomLeftY = imageCoordinates[offset + 3];
  const topRightX = imageCoordinates[offset + 4];
  const topRightY = imageCoordinates[offset + 5];
  const leftX = bottomLeftX - topLeftX;
  const leftY = bottomLeftY - topLeftY;
  const topX = topRightX - topLeftX;
  const topY = topRightY - topLeftY;

  return Math.abs(leftX * topY - leftY * topX);
}

function hasPageSizedImage(imageCoordinates) {
  for (let offset = 0; offset + 5 < imageCoordinates.length; offset += 6) {
    if (imageAreaFraction(imageCoordinates, offset) >= SCANNED_PAGE_IMAGE_AREA_THRESHOLD) {
      return true;
    }
  }

  return false;
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

function createImageOverlayCanvas(baseCanvas, viewport, imageCoordinates) {
  const overlay = document.createElement("canvas");
  const context = overlay.getContext("2d", { alpha: true });

  overlay.className = "page-image-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.width = baseCanvas.width;
  overlay.height = baseCanvas.height;
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.zIndex = "1";
  overlay.style.pointerEvents = "none";
  overlay.style.filter = "none";
  overlay.style.display = document.documentElement.dataset.theme === "dark" ? "block" : "none";

  context.beginPath();
  for (let offset = 0; offset + 5 < imageCoordinates.length; offset += 6) {
    const topLeftX = clampUnit(imageCoordinates[offset]) * overlay.width;
    const topLeftY = clampUnit(imageCoordinates[offset + 1]) * overlay.height;
    const bottomLeftX = clampUnit(imageCoordinates[offset + 2]) * overlay.width;
    const bottomLeftY = clampUnit(imageCoordinates[offset + 3]) * overlay.height;
    const topRightX = clampUnit(imageCoordinates[offset + 4]) * overlay.width;
    const topRightY = clampUnit(imageCoordinates[offset + 5]) * overlay.height;
    const bottomRightX = bottomLeftX + topRightX - topLeftX;
    const bottomRightY = bottomLeftY + topRightY - topLeftY;

    context.moveTo(topLeftX, topLeftY);
    context.lineTo(bottomLeftX, bottomLeftY);
    context.lineTo(bottomRightX, bottomRightY);
    context.lineTo(topRightX, topRightY);
    context.closePath();
  }
  context.clip();
  context.drawImage(baseCanvas, 0, 0);

  return overlay;
}

function getInitialPage(...urls) {
  for (const url of urls) {
    const match = url.hash.match(/(?:^#|[&#])page=(\d+)/i);
    if (match) {
      return Math.max(1, Number.parseInt(match[1], 10));
    }
  }

  return 1;
}

function setCurrentPage(pageNumber, deferSharpRender = false) {
  if (!pdfDocument) {
    return;
  }

  const nextPage = Math.min(Math.max(pageNumber, 1), pdfDocument.numPages);
  if (currentPage === nextPage && pageNumberInput.value === String(nextPage)) {
    return;
  }

  currentPage = nextPage;
  pagePreviews?.update(currentPage);
  pageNumberInput.value = String(currentPage);
  window.dispatchEvent(new CustomEvent("pdf-viewer-page-changed", { detail: { pageNumber: currentPage } }));
  previousButton.disabled = currentPage <= 1;
  nextButton.disabled = currentPage >= pdfDocument.numPages;
  clearTimeout(sharpRenderTimer);
  if (deferSharpRender && !renderingAllPages) {
    // Cached previews follow scrolling immediately. Avoid spending time on
    // sharp pages that the reader is already scrolling past.
    priorityRenderQueue.clear();
    backgroundRenderQueue.clear();
    keepRenderWindow(currentPage, false);
    sharpRenderTimer = setTimeout(() => {
      void queuePageRender(currentPage, true);
      keepRenderWindow(currentPage);
    }, 120);
  } else {
    void queuePageRender(currentPage, true);
    keepRenderWindow(currentPage);
  }

  if (!sectionPopover.hidden) {
    void updateCurrentSectionHighlight();
  }

  if (!mimeHandlerActive) {
    const viewerUrl = new URL(window.location.href);
    viewerUrl.hash = `page=${currentPage}`;
    history.replaceState(null, "", viewerUrl);
  }
}

function pageAtViewportCenter() {
  const toolbarHeight = 52;
  const y = toolbarHeight + (window.innerHeight - toolbarHeight) / 2;
  const target = document.elementFromPoint(window.innerWidth / 2, y)?.closest(".page");

  if (target?.dataset.page) {
    setCurrentPage(Number.parseInt(target.dataset.page, 10), true);
  }
}

function schedulePageTracking() {
  if (scrollFrame) {
    return;
  }

  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = undefined;
    pageAtViewportCenter();
  });
}

function goToPage(pageNumber, behavior = "smooth") {
  if (!pdfDocument) {
    return;
  }

  const nextPage = Math.min(Math.max(pageNumber, 1), pdfDocument.numPages);
  setCurrentPage(nextPage);
  void queuePageRender(nextPage, true);
  const scrollBehavior = behavior === "auto" ? "instant" : behavior;

  const pageElement = pageElements[nextPage - 1];
  if (!pageElement) {
    return;
  }

  // Page one belongs at the top of the document, even when it fits on screen.
  // Centering a short first page leaves a large empty area above it.
  if (nextPage === 1) {
    window.scrollTo({ top: 0, behavior: scrollBehavior });
    return;
  }

  const toolbarHeight = 52;
  const pageGap = 24;
  const readableHeight = window.innerHeight - toolbarHeight - pageGap * 2;
  const pageRect = pageElement.getBoundingClientRect();

  if (pageRect.height <= readableHeight) {
    pageElement.scrollIntoView({ behavior: scrollBehavior, block: "center" });
    return;
  }

  const pageTop = window.scrollY + pageRect.top;
  window.scrollTo({
    top: Math.max(0, pageTop - toolbarHeight - pageGap),
    behavior: scrollBehavior,
  });
}

function goToFootnote(target) {
  if (!pdfDocument || !target) return;
  const page = pageElements[target.pageNumber - 1];
  if (!page) return;

  setCurrentPage(target.pageNumber);
  highlightFootnote(target, pageElements, rotation);
  const toolbarHeight = document.querySelector(".toolbar")?.getBoundingClientRect().height || 52;
  const scrubberHeight = document.querySelector("#document-scrubber")?.getBoundingClientRect().height || 0;
  const readableHeight = Math.max(1, window.innerHeight - toolbarHeight - scrubberHeight);
  const rect = page.getBoundingClientRect();
  window.scrollTo({
    top: Math.max(0, window.scrollY + rect.top + rect.height * target.yRatio - toolbarHeight - readableHeight / 2),
    behavior: "instant",
  });
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 1800);
}

function outlineHasDestination(items) {
  return items.some(
    (item) => Boolean(item.dest) || (item.items?.length && outlineHasDestination(item.items)),
  );
}

function sectionReferenceFromTitle(title) {
  const match = title.match(
    /^((?:[IVXLCDM]+|[A-Z]|\d+|[a-z])(?:\.(?:[IVXLCDM]+|[A-Z]|\d+|[a-z]))*)[.)]?(?=\s|$)/,
  );
  return match?.[1] || "";
}

function fullSectionReference(parentReference, localReference) {
  if (!parentReference || localReference.includes(".")) {
    return localReference;
  }

  return `${parentReference}.${localReference}`;
}

function fallbackSectionReference(parentReference, position) {
  return parentReference ? `${parentReference}.${position}` : String(position);
}

function fallbackSectionCopyText(reference, title) {
  return `${reference} ("${title}")`;
}

async function copySectionReference(reference) {
  try {
    await navigator.clipboard.writeText(reference);
    showToast(`Copied ${reference}`);
  } catch {
    showToast("Could not copy section reference");
  }
}

async function resolveOutlinePageNumber(item) {
  let destination = item.dest;

  if (typeof destination === "string") {
    destination = await pdfDocument.getDestination(destination);
  }

  if (!Array.isArray(destination) || destination.length === 0) {
    return null;
  }

  const pageReference = destination[0];
  const pageIndex = Number.isInteger(pageReference)
    ? pageReference
    : await pdfDocument.getPageIndex(pageReference);

  return pageIndex + 1;
}

function sectionEntryPageNumber(entry) {
  if (!entry.pageNumberPromise) {
    entry.pageNumberPromise = resolveOutlinePageNumber(entry.item).catch(() => null);
  }

  return entry.pageNumberPromise;
}

async function updateCurrentSectionHighlight(scrollToCurrent = false) {
  if (!sectionEntries.length) {
    return;
  }

  const requestId = ++sectionHighlightRequestId;
  const pageNumbers = await Promise.all(sectionEntries.map(sectionEntryPageNumber));

  if (requestId !== sectionHighlightRequestId) {
    return;
  }

  let activeIndex = -1;
  let activePage = 0;

  for (let index = 0; index < sectionEntries.length; index += 1) {
    const pageNumber = pageNumbers[index];
    if (pageNumber === null || pageNumber > currentPage) {
      continue;
    }

    if (pageNumber > activePage || (pageNumber === activePage && index > activeIndex)) {
      activeIndex = index;
      activePage = pageNumber;
    }
  }

  for (let index = 0; index < sectionEntries.length; index += 1) {
    const row = sectionEntries[index].row;
    const isCurrent = index === activeIndex;
    row.style.background = isCurrent ? "#29292d" : "";
    row.style.borderRadius = isCurrent ? "7px" : "";

    if (isCurrent) {
      row.setAttribute("aria-current", "location");
    } else {
      row.removeAttribute("aria-current");
    }
  }

  if (scrollToCurrent && activeIndex >= 0) {
    sectionEntries[activeIndex].row.scrollIntoView({ block: "nearest" });
  }
}

function closeSectionPopover() {
  sectionPopover.hidden = true;
  sectionToggle.setAttribute("aria-expanded", "false");
}

function toggleSectionPopover() {
  const opening = sectionPopover.hidden;
  sectionPopover.hidden = !opening;
  sectionToggle.setAttribute("aria-expanded", String(opening));

  if (opening) {
    void updateCurrentSectionHighlight(true);
  }
}

async function navigateToOutlineItem(item) {
  try {
    const pageNumber = await resolveOutlinePageNumber(item);
    if (pageNumber === null) {
      return;
    }

    goToPage(pageNumber);
    closeSectionPopover();
  } catch {
    showToast("Could not open that section");
  }
}

function createOutlineList(items, parentReference = "") {
  const list = document.createElement("ul");
  let visiblePosition = 0;

  for (const item of items) {
    const children = item.items || [];
    const hasDestination = Boolean(item.dest);
    const hasChildDestination = children.length > 0 && outlineHasDestination(children);
    const title = item.title?.trim();

    if (!title || (!hasDestination && !hasChildDestination)) {
      continue;
    }

    visiblePosition += 1;
    const localReference = sectionReferenceFromTitle(title);
    const hasExplicitReference = Boolean(localReference);
    const sectionReference = hasExplicitReference
      ? fullSectionReference(parentReference, localReference)
      : fallbackSectionReference(parentReference, visiblePosition);
    const copyText = hasExplicitReference
      ? sectionReference
      : fallbackSectionCopyText(sectionReference, title);
    const entry = document.createElement("li");
    const row = document.createElement("div");
    entry.className = "section-entry";
    row.className = "section-entry-row";

    if (hasDestination) {
      sectionEntries.push({ item, row, pageNumberPromise: null });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "section-link";
      button.textContent = title;
      button.addEventListener("click", () => void navigateToOutlineItem(item));
      row.append(button);
    } else {
      const heading = document.createElement("span");
      heading.className = "section-heading";
      heading.textContent = title;
      row.append(heading);
    }

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "section-copy";
    const copyIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    copyIcon.classList.add("toolbar-icon");
    copyIcon.setAttribute("viewBox", "0 0 24 24");
    copyIcon.setAttribute("aria-hidden", "true");
    for (const data of ["M9 17H7a5 5 0 0 1 0-10h3", "M15 7h2a5 5 0 1 1 0 10h-3", "M8 12h8"]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", data);
      copyIcon.append(path);
    }
    copyButton.append(copyIcon);
    copyButton.title = `Copy section reference ${copyText}`;
    copyButton.setAttribute("aria-label", copyButton.title);
    copyButton.addEventListener("click", () => void copySectionReference(copyText));
    row.append(copyButton);

    entry.append(row);

    if (hasChildDestination) {
      entry.append(createOutlineList(children, sectionReference));
    }

    list.append(entry);
  }

  return list;
}

function metadataText(value) {
  if (Array.isArray(value)) {
    return value.map(metadataText).filter(Boolean).join(", ");
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function metadataValue(info, metadata, infoKey, xmpKey) {
  const infoValue = metadataText(info?.[infoKey]);
  return infoValue || metadataText(metadata?.get?.(xmpKey));
}

function renderPdfMetadata(entries) {
  const fragment = document.createDocumentFragment();

  for (const { label, value } of entries) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    row.className = "section-metadata-row";
    term.textContent = label;
    if (label === "Href" && /^(?:https?:|file:)/i.test(value)) {
      const link = document.createElement("a");
      link.href = value;
      link.textContent = value;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      description.append(link);
    } else {
      description.textContent = value;
    }
    row.append(term, description);
    fragment.append(row);
  }

  sectionMetadataList.replaceChildren(fragment);
  sectionMetadata.hidden = entries.length === 0;
}

async function getPdfMetadataDetails() {
  try {
    const { info, metadata } = await pdfDocument.getMetadata();
    const title = metadataValue(info, metadata, "Title", "dc:title");
    const entries = PDF_METADATA_FIELDS.map(([label, infoKey, xmpKey]) => ({
      label,
      value: metadataValue(info, metadata, infoKey, xmpKey),
    })).filter(({ value }) => Boolean(value));

    const href = referenceUrlFromPdfMetadata(info, metadata);
    if (href) entries.push({ label: "Href", value: href });
    return { title, entries };
  } catch {
    return { title: "", entries: [] };
  }
}

async function initializeSectionNavigation() {
  let outline;

  try {
    outline = await pdfDocument.getOutline();
  } catch {
    return;
  }

  if (!outline?.length || !outlineHasDestination(outline)) {
    return;
  }

  sectionEntries = [];
  const outlineList = createOutlineList(outline);
  if (!outlineList.childElementCount) {
    return;
  }

  const { title: metadataTitle, entries: metadataEntries } = await getPdfMetadataDetails();
  if (metadataTitle) {
    sectionDocumentTitle.textContent = metadataTitle;
    sectionDocumentTitle.hidden = false;
  }
  renderPdfMetadata(metadataEntries);

  sectionList.replaceChildren(outlineList);
  sectionNav.hidden = false;
}

function setToolsMenuOpen(open) {
  toolsMenu.hidden = !open;
  toolsButton.setAttribute("aria-expanded", String(open));
}

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);

  const isDark = nextTheme === "dark";
  themeIcon.classList.toggle("celestia-icon", isDark);
  themeIcon.src = isDark ? CELESTIA_ICON : LUNA_ICON;
  shareIcon.src = isDark ? DARK_MODE_SHARE_ICON : LIGHT_MODE_SHARE_ICON;
  themeButton.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  themeButton.setAttribute("aria-label", themeButton.title);

  for (const overlay of document.querySelectorAll(".page-image-overlay")) {
    overlay.style.display = isDark ? "block" : "none";
  }
}

function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function refreshSearchHighlights(query = completedSearchQuery) {
  for (const pageElement of pageElements) {
    const textLayer = pageElement.querySelector(".text-layer");
    if (textLayer) {
      highlightTextLayer(textLayer, query);
    }
  }
}

function yieldToBrowser() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function markDocumentReady() {
  const requiredPageCount = Math.min(2, pdfDocument.numPages);
  if (renderedPages.size < requiredPageCount) {
    return;
  }

  const root = document.documentElement;
  if (root.classList.contains("document-ready")) {
    return;
  }

  root.classList.add("document-ready");
  window.dispatchEvent(new Event("pdf-viewer-document-ready"));
}

function pageIsInRenderWindow(pageNumber) {
  return Math.abs(pageNumber - currentPage) <= RENDER_WINDOW_RADIUS;
}

function takeNextQueuedPage() {
  const queue = priorityRenderQueue.size > 0 ? priorityRenderQueue : backgroundRenderQueue;
  if (queue.size === 0) {
    return undefined;
  }

  let pageNumber;
  for (const queuedPage of queue) {
    if (pageNumber === undefined || Math.abs(queuedPage - currentPage) < Math.abs(pageNumber - currentPage)) {
      pageNumber = queuedPage;
    }
  }

  queue.delete(pageNumber);
  return pageNumber;
}

async function renderPageNow(pageNumber) {
  if (renderedPages.has(pageNumber)) {
    return;
  }

  const generation = renderGeneration;
  const page = await pdfDocument.getPage(pageNumber);
  const container = pageElements[pageNumber - 1];
  const baseViewport = page.getViewport({ scale: 1, rotation });
  const cssWidth = Math.max(1, container.clientWidth);
  const viewport = page.getViewport({ scale: cssWidth / baseViewport.width, rotation });
  const annotationViewport = viewport.clone({ dontFlip: true });
  container.style.setProperty("--total-scale-factor", String(viewport.scale));
  container.style.setProperty("--scale-round-x", "1px");
  container.style.setProperty("--scale-round-y", "1px");
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  const renderTransform =
    outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  const textLayer = document.createElement("div");
  const annotationLayer = document.createElement("div");
  textLayer.className = "text-layer";
  annotationLayer.className = "annotation-layer";

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  // CSS fits the bitmap to the page, including while an old render is kept
  // during resizing. Fixed pixel styles would clip it in a compressed pane.

  const textContent = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
  const textLayerTask = new TextLayer({
    textContentSource: textContent,
    container: textLayer,
    viewport,
  });

  page.imageCoordinates = null;
  const renderTask = page.render({
    canvasContext: context,
    viewport,
    transform: renderTransform,
    recordImages: true,
  });
  const [annotations] = await Promise.all([
    page.getAnnotations({ intent: "display" }),
    renderTask.promise,
    textLayerTask.render(),
  ]);

  if (generation !== renderGeneration || (!renderingAllPages && !pageIsInRenderWindow(pageNumber))) {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    return;
  }

  if (annotations.length) {
    const annotationLayerTask = new AnnotationLayer({
      accessibilityManager: null,
      annotationCanvasMap: null,
      annotationEditorUIManager: null,
      annotationStorage: pdfDocument.annotationStorage,
      commentManager: null,
      div: annotationLayer,
      linkService: pdfLinkService,
      page,
      structTreeLayer: null,
      viewport: annotationViewport,
    });
    await annotationLayerTask.render({
      annotations,
      div: annotationLayer,
      linkService: pdfLinkService,
      page,
      renderForms: false,
      viewport: annotationViewport,
    });
  }

  if (generation !== renderGeneration || (!renderingAllPages && !pageIsInRenderWindow(pageNumber))) {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    return;
  }

  let imageOverlay;
  const imageCoordinates = page.imageCoordinates;
  if (imageCoordinates?.length && !hasPageSizedImage(imageCoordinates)) {
    imageOverlay = createImageOverlayCanvas(canvas, viewport, imageCoordinates);
  }

  container.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
  registerSearchText(textLayer, textContent.items.filter(item => "str" in item), textLayerTask.textDivs);
  container.replaceChildren(
    canvas,
    ...(imageOverlay ? [imageOverlay] : []),
    textLayer,
    ...(annotations.length ? [annotationLayer] : []),
  );
  container.classList.add("rendered");
  highlightTextLayer(textLayer, completedSearchQuery);
  renderFootnoteHighlight(container, pageNumber, rotation);
  renderedPages.add(pageNumber);
  staleRenderedPages.delete(pageNumber);
  pagePreviews?.hide(pageNumber);
  markDocumentReady();
  page.cleanup();
}

function drainRenderQueue() {
  if (renderQueuePromise) {
    return renderQueuePromise;
  }

  renderQueuePromise = (async () => {
    try {
      let pageNumber = takeNextQueuedPage();
      while (pageNumber !== undefined) {
        await renderPageNow(pageNumber);
        await yieldToBrowser();
        pageNumber = takeNextQueuedPage();
      }
    } finally {
      renderQueuePromise = undefined;
      if (priorityRenderQueue.size > 0 || backgroundRenderQueue.size > 0) {
        void drainRenderQueue();
      }
    }
  })();

  return renderQueuePromise;
}

function queuePageRender(pageNumber, priority = false) {
  if (!pdfDocument || renderedPages.has(pageNumber)) {
    return Promise.resolve();
  }

  backgroundRenderQueue.delete(pageNumber);
  if (priority) {
    priorityRenderQueue.add(pageNumber);
  } else if (!priorityRenderQueue.has(pageNumber)) {
    backgroundRenderQueue.add(pageNumber);
  }

  return drainRenderQueue();
}

function releaseRenderedPage(pageNumber) {
  const container = pageElements[pageNumber - 1];
  if (!container) {
    return;
  }

  for (const canvas of container.querySelectorAll("canvas")) {
    canvas.width = 0;
    canvas.height = 0;
  }

  container.replaceChildren();
  container.classList.remove("rendered");
  renderedPages.delete(pageNumber);
  staleRenderedPages.delete(pageNumber);
  pagePreviews?.show(pageNumber);
  priorityRenderQueue.delete(pageNumber);
  backgroundRenderQueue.delete(pageNumber);
}

function keepRenderWindow(centerPage = currentPage, queueNearby = true) {
  if (!pdfDocument) {
    return;
  }

  if (renderingAllPages) return;
  pagePreviews?.update(centerPage);

  const firstPage = Math.max(1, centerPage - RENDER_WINDOW_RADIUS);
  const lastPage = Math.min(pdfDocument.numPages, centerPage + RENDER_WINDOW_RADIUS);

  for (const pageNumber of new Set([...renderedPages, ...staleRenderedPages])) {
    if (pageNumber < firstPage || pageNumber > lastPage) {
      releaseRenderedPage(pageNumber);
    }
  }

  for (const pageNumber of [...backgroundRenderQueue]) {
    if (pageNumber < firstPage || pageNumber > lastPage) {
      backgroundRenderQueue.delete(pageNumber);
    }
  }

  for (const pageNumber of [...priorityRenderQueue]) {
    if (pageNumber < firstPage || pageNumber > lastPage) {
      priorityRenderQueue.delete(pageNumber);
    }
  }

  for (let pageNumber = firstPage; queueNearby && pageNumber <= lastPage; pageNumber += 1) {
    void queuePageRender(pageNumber, pageNumber === centerPage);
  }
}

function queueAllPages() {
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (!renderedPages.has(pageNumber) && !priorityRenderQueue.has(pageNumber)) {
      backgroundRenderQueue.add(pageNumber);
    }
  }

  return drainRenderQueue();
}

function createPagePlaceholders(sampleViewport) {
  const fragment = document.createDocumentFragment();
  const ratio = `${sampleViewport.width} / ${sampleViewport.height}`;

  pageElements = Array.from({ length: pdfDocument.numPages }, (_, index) => {
    const pageNumber = index + 1;
    const element = document.createElement("section");
    element.className = "page";
    element.dataset.page = String(pageNumber);
    element.setAttribute("aria-label", `Page ${pageNumber}`);
    element.style.setProperty("--page-ratio", ratio);
    fragment.append(element);
    return element;
  });

  viewer.append(fragment);
}

async function getPageSearchItems(pageNumber) {
  if (pageTextCache.has(pageNumber)) return pageTextCache.get(pageNumber);
  const page = await pdfDocument.getPage(pageNumber);
  const content = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
  const items = content.items.filter(item => "str" in item);
  pageTextCache.set(pageNumber, items);
  return items;
}

function clearSearchPageMarker() {
  document.querySelector(".page.search-match-page")?.classList.remove("search-match-page");
}

function setSearchEmptyState(empty) {
  searchControl.classList.toggle("search-empty", empty);
}

function resetSearchResults() {
  searchMatches = [];
  activeSearchIndex = -1;
  completedSearchQuery = "";
  searchCount.textContent = "";
  searchFirstButton.disabled = true;
  searchPreviousButton.disabled = true;
  searchNextButton.disabled = true;
  setSearchEmptyState(false);
  clearSearchPageMarker();
  refreshSearchHighlights("");
}

function showSearchMatch(index, behavior = "auto") {
  if (!searchMatches.length) {
    return;
  }

  activeSearchIndex = (index + searchMatches.length) % searchMatches.length;
  const match = searchMatches[activeSearchIndex];

  searchCount.textContent = `${activeSearchIndex + 1} / ${searchMatches.length}`;
  setSearchEmptyState(false);
  searchFirstButton.disabled = activeSearchIndex === 0;
  searchPreviousButton.disabled = false;
  searchNextButton.disabled = false;

  clearSearchPageMarker();
  const pageElement = pageElements[match.pageNumber - 1];
  if (pageElement) {
    pageElement.dataset.searchMatchOrdinal = String(match.ordinal);
    pageElement.dataset.searchQuery = completedSearchQuery;
    pageElement.classList.add("search-match-page");
  }

  goToPage(match.pageNumber, behavior);
  void queuePageRender(match.pageNumber, true).then(() => refreshSearchHighlights());
}

async function runSearch(rawQuery) {
  const query = normalizeSearchText(rawQuery);
  const requestId = ++searchRequestId;
  const searchStartPage = currentPage;

  clearTimeout(searchTimer);

  if (!query || !pdfDocument) {
    resetSearchResults();
    return;
  }

  searchCount.textContent = "…";
  setSearchEmptyState(false);
  searchFirstButton.disabled = true;
  searchPreviousButton.disabled = true;
  searchNextButton.disabled = true;
  clearSearchPageMarker();

  const matches = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const items = await getPageSearchItems(pageNumber);
    if (requestId !== searchRequestId) return;
    for (const { offset, ordinal } of findSearchMatches(items, query)) {
      matches.push({ pageNumber, offset, ordinal });
    }
  }

  if (requestId !== searchRequestId) {
    return;
  }

  searchMatches = matches;
  completedSearchQuery = query;
  refreshSearchHighlights(query);

  if (!matches.length) {
    activeSearchIndex = -1;
    searchCount.textContent = "No results";
    setSearchEmptyState(true);
    searchFirstButton.disabled = true;
    searchPreviousButton.disabled = true;
    searchNextButton.disabled = true;
    return;
  }

  const nearbyMatchIndex = matches.findIndex((match) => match.pageNumber >= searchStartPage);
  showSearchMatch(nearbyMatchIndex === -1 ? 0 : nearbyMatchIndex, "auto");
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchRequestId += 1;

  const query = normalizeSearchText(searchInput.value);
  if (!query) {
    resetSearchResults();
    return;
  }

  searchCount.textContent = "…";
  setSearchEmptyState(false);
  searchFirstButton.disabled = true;
  searchPreviousButton.disabled = true;
  searchNextButton.disabled = true;
  clearSearchPageMarker();

  searchTimer = setTimeout(() => {
    void runSearch(query);
  }, 180);
}

function stepSearch(delta) {
  const query = normalizeSearchText(searchInput.value);

  if (!query) {
    return;
  }

  if (query !== completedSearchQuery) {
    void runSearch(searchInput.value);
    return;
  }

  if (searchMatches.length) {
    showSearchMatch(activeSearchIndex + delta);
  }
}

function getSelectedPdfText() {
  const selection = window.getSelection();

  if (
    !selection ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !viewer.contains(selection.anchorNode) ||
    !viewer.contains(selection.focusNode)
  ) {
    return "";
  }

  return selection.toString().replace(/\s+/g, " ").trim();
}

function focusSearch() {
  searchInput.focus();
  searchInput.select();
}

function focusSearchFromSelection() {
  const selectedText = getSelectedPdfText();

  if (selectedText) {
    searchInput.value = selectedText;
  }

  focusSearch();

  if (selectedText) {
    void runSearch(selectedText);
  }
}

async function refreshPageRendering() {
  if (!pdfDocument) {
    return;
  }

  // Zoom layout changes happen after the resize event's tracking frame.
  // Use the pages' final positions, rather than the pre-resize page number.
  pageAtViewportCenter();
  clearTimeout(sharpRenderTimer);
  renderGeneration += 1;
  priorityRenderQueue.clear();
  backgroundRenderQueue.clear();
  for (const pageNumber of [...renderedPages]) {
    staleRenderedPages.add(pageNumber);
  }
  renderedPages.clear();

  // Queue the whole window before waiting: scroll tracking can clear queued
  // work while an older render is finishing, including the center page.
  const rendering = queuePageRender(currentPage, true);
  keepRenderWindow(currentPage);
  await rendering;
}

async function rotatePages(delta) {
  if (!pdfDocument) {
    return;
  }

  rotation = (rotation + delta + 360) % 360;
  pagePreviews?.start(rotation, currentPage);
  await refreshPageRendering();
  pageElements[currentPage - 1]?.scrollIntoView({ behavior: "auto", block: "center" });
}

async function shareCurrentPage() {
  const referenceUrl = await resolveDocumentReferenceUrl();
  if (!referenceUrl) {
    return;
  }

  const shareUrl = new URL(referenceUrl);
  shareUrl.hash = `page=${currentPage}`;

  try {
    await navigator.clipboard.writeText(shareUrl.href);
  } catch {
    // Keep the copy control silent if clipboard access is unavailable.
  }
}

async function printPdf() {
  if (!pdfDocument) {
    return;
  }

  setToolsMenuOpen(false);
  let cleanupPrintDocument;

  try {
    cleanupPrintDocument = await preparePrintDocument({
      pdfDocument,
      rotation,
      onProgress(pageNumber, pageCount) {
        showToast(`Preparing page ${pageNumber} of ${pageCount} for print…`);
      },
    });
    document.documentElement.classList.add("pdf-print-ready");
    window.print();
  } catch (error) {
    console.error("Could not prepare PDF for printing.", error);
    showToast("Could not prepare PDF for printing");
  } finally {
    document.documentElement.classList.remove("pdf-print-ready");
    cleanupPrintDocument?.();
    keepRenderWindow(currentPage);
  }
}

async function downloadPdf() {
  if (!pdfDocument) {
    return;
  }

  setToolsMenuOpen(false);
  showToast("Preparing download…");
  const data = await pdfDocument.getData();
  const blob = new Blob([data], { type: "application/pdf" });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function bindControls() {
  window.addEventListener("pdf-viewer-footnote-jump", (event) => goToFootnote(event.detail));
  window.addEventListener("pdf-viewer-section-cross-reference-target", (event) => {
    highlightFootnote({ highlightRegions: [] }, pageElements, rotation);
    void navigateToOutlineItem(event.detail);
  });
  previousButton.addEventListener("click", () => goToPage(currentPage - 1));
  nextButton.addEventListener("click", () => goToPage(currentPage + 1));
  shareButton.addEventListener("click", () => void shareCurrentPage());
  sectionToggle.addEventListener("click", toggleSectionPopover);

  document.addEventListener("pointerdown", (event) => {
    if (!sectionPopover.hidden && !sectionNav.contains(event.target)) {
      closeSectionPopover();
    }
  });
  themeButton.addEventListener("click", toggleTheme);
  toolsButton.addEventListener("click", () => {
    setToolsMenuOpen(toolsMenu.hidden);
  });

  rotateLeftButton.addEventListener("click", () => void rotatePages(-90));
  rotateRightButton.addEventListener("click", () => void rotatePages(90));
  printButton.addEventListener("click", () => void printPdf());
  downloadButton.addEventListener("click", () => void downloadPdf());

  pageNumberInput.addEventListener("change", () => {
    goToPage(Number.parseInt(pageNumberInput.value, 10) || currentPage, "auto");
  });

  pageNumberInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      pageNumberInput.blur();
    }
  });

  searchInput.addEventListener("input", scheduleSearch);
  searchFirstButton.addEventListener("click", () => showSearchMatch(0));
  searchPreviousButton.addEventListener("click", () => stepSearch(-1));
  searchNextButton.addEventListener("click", () => stepSearch(1));

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      stepSearch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      searchInput.blur();
    }
  });

  document.addEventListener(
    "keydown",
    (event) => {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (modifier && key === "f") {
        event.preventDefault();
        event.stopPropagation();
        focusSearchFromSelection();
        return;
      }

      if ((modifier && key === "g") || event.key === "F3") {
        if (!searchInput.value.trim()) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        stepSearch(event.shiftKey ? -1 : 1);
      }
    },
    true,
  );

  document.addEventListener("pointerdown", (event) => {
    if (!toolsMenu.hidden && !tools.contains(event.target)) {
      setToolsMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !toolsMenu.hidden) {
      setToolsMenuOpen(false);
      toolsButton.focus();
      return;
    }

    if (event.key === "Escape" && !sectionPopover.hidden) {
      closeSectionPopover();
      sectionToggle.focus();
      return;
    }

    if (
      document.activeElement === pageNumberInput ||
      document.activeElement === searchInput ||
      sectionPopover.contains(document.activeElement)
    ) {
      return;
    }

    if (event.key === "ArrowLeft") {
      goToPage(currentPage - 1);
    } else if (event.key === "ArrowRight") {
      goToPage(currentPage + 1);
    }
  });

  window.addEventListener("scroll", schedulePageTracking, { passive: true });
  window.addEventListener("resize", schedulePageTracking);
  window.addEventListener("pdf-viewer-rerender", () => {
    void refreshPageRendering();
  });
}

async function initialize() {
  setTheme(localStorage.getItem(THEME_STORAGE_KEY) || "dark");
  const resolvedSource = await resolvePdfSource();
  mimeHandlerActive = resolvedSource.mimeHandlerActive;
  originalUrl = resolvedSource.originalUrl;
  const requestedPage = getInitialPage(window.location, originalUrl);
  requestUrl = new URL(originalUrl.href);
  requestUrl.hash = "";

  fileName = decodeURIComponent(requestUrl.pathname.split("/").filter(Boolean).pop() || "document.pdf");
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    fileName += ".pdf";
  }

  const documentOptions = {
    cMapUrl: extensionAssetUrl("node_modules/pdfjs-dist/cmaps/", "cmaps/"),
    cMapPacked: true,
    // Local files and blob URLs cannot serve as PDF.js link-resolution bases.
    docBaseUrl: createValidAbsoluteUrl(requestUrl.href)?.href,
    // PDF.js recovers from missing fonts and malformed font hints internally.
    // Keep actual failures visible without filling the extension's error log.
    verbosity: VerbosityLevel.ERRORS,
    standardFontDataUrl: extensionAssetUrl(
      "node_modules/pdfjs-dist/standard_fonts/",
      "standard_fonts/",
    ),
    wasmUrl: extensionAssetUrl("node_modules/pdfjs-dist/wasm/", "wasm/"),
  };

  if (resolvedSource.data) {
    documentOptions.data = resolvedSource.data;
  } else {
    documentOptions.url = resolvedSource.url;
    documentOptions.withCredentials = true;
  }

  const loadingTask = getDocument(documentOptions);
  pdfDocument = await loadingTask.promise;
  publishPdfDocument(pdfDocument, OPS);
  pdfLinkService = new PDFLinkService({
    eventBus: new EventBus(),
    externalLinkTarget: 2,
    externalLinkRel: "noopener noreferrer",
  });
  pdfLinkService.setDocument(pdfDocument);
  pdfLinkService.setViewer({
    scrollPageIntoView({ pageNumber }) {
      goToPage(pageNumber);
    },
  });
  currentPage = Math.min(requestedPage, pdfDocument.numPages);
  pageCount.textContent = String(pdfDocument.numPages);
  pageNumberInput.max = String(pdfDocument.numPages);

  const samplePage = await pdfDocument.getPage(currentPage);
  createPagePlaceholders(samplePage.getViewport({ scale: 1 }));
  samplePage.cleanup();
  pagePreviews = new PagePreviews({
    pdfDocument,
    pages: pageElements,
    isSharp: (pageNumber) => renderedPages.has(pageNumber) || staleRenderedPages.has(pageNumber),
    waitForForeground: () => renderQueuePromise?.catch(() => {}),
  });
  bindControls();
  await initializeSectionNavigation();
  goToPage(currentPage, "auto");
  keepRenderWindow(currentPage);
  pagePreviews.start(rotation, currentPage);
}

window.addEventListener("pagehide", () => {
  clearTimeout(sharpRenderTimer);
  pagePreviews?.stop();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) pagePreviews?.start(rotation, currentPage);
});

initialize().catch(async (error) => {
  abandonPdfDocumentSession();
  if (mimeHandlerActive && chrome.mimeHandler?.abortAndFallbackToNativeHandler) {
    try {
      await chrome.mimeHandler.abortAndFallbackToNativeHandler();
      return;
    } catch {
      // If native fallback itself fails, show the viewer error below.
    }
  }

  status.classList.add("error");
  status.textContent = `Could not open this PDF. ${error?.message || error}`;
  previousButton.disabled = true;
  nextButton.disabled = true;
  shareButton.disabled = true;
  themeButton.disabled = true;
  toolsButton.disabled = true;
  pageNumberInput.disabled = true;
  searchInput.disabled = true;
  searchFirstButton.disabled = true;
  searchPreviousButton.disabled = true;
  searchNextButton.disabled = true;
});
