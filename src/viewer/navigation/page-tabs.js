import { pdfDocumentSessionReady } from "../pdf-document-session.js";
import { findPrintedPageCounter, mergedPageTabLabels } from "./page-tab-labels.js";

const rail = document.querySelector("#page-tabs");
const pageInput = document.querySelector("#page-number");
const root = document.documentElement;
let documentSession;
let tabs = [];
let labels = [];
let selectedPage = 0;
let counters = [];
let nextPageToScan = 0;
let scanRunning = false;
let embeddedLabels = null;
let metadataLoaded = false;

function isVisible() {
  return root.classList.contains("minimap-page-tabs") &&
    !root.classList.contains("minimap-disabled") &&
    !root.classList.contains("minimap-collapsed") &&
    window.innerWidth > 700;
}

function keepSelectedTabVisible(tab) {
  if (!tab || !isVisible()) return;
  const top = tab.offsetTop - rail.offsetTop;
  if (top < rail.scrollTop) rail.scrollTop = top;
  else if (top + tab.offsetHeight > rail.scrollTop + rail.clientHeight) {
    rail.scrollTop = top + tab.offsetHeight - rail.clientHeight;
  }
}

function selectPage(pageNumber) {
  if (!tabs.length || !Number.isInteger(pageNumber)) return;
  const page = Math.min(Math.max(pageNumber, 1), tabs.length);
  if (page === selectedPage && tabs[page - 1]?.getAttribute("aria-current") === "page") return;
  if (selectedPage > 0) tabs[selectedPage - 1]?.removeAttribute("aria-current");
  selectedPage = page;
  tabs[page - 1].setAttribute("aria-current", "page");
  keepSelectedTabVisible(tabs[page - 1]);
}

function navigateToPage(pageNumber) {
  pageInput.value = String(pageNumber);
  pageInput.dispatchEvent(new Event("change", { bubbles: true }));
  selectPage(pageNumber);
}

function renderLabels(nextLabels) {
  for (let index = 0; index < tabs.length; index += 1) {
    const label = nextLabels[index];
    if (labels[index] === label) continue;
    const tab = tabs[index];
    tab.textContent = label;
    tab.title = label === String(index + 1)
      ? `PDF page ${index + 1}` : `Document page ${label} (PDF page ${index + 1})`;
    tab.setAttribute("aria-label", `Go to document page ${label}, PDF page ${index + 1}`);
  }
  labels = nextLabels;
}

async function scanVisiblePageNumbers() {
  if (scanRunning || embeddedLabels || !metadataLoaded || !documentSession || !isVisible()) return;
  scanRunning = true;
  const pdf = documentSession.document;
  try {
    while (nextPageToScan < pdf.numPages && isVisible()) {
      const index = nextPageToScan++;
      try {
        const page = await pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        counters[index] = findPrintedPageCounter(content.items, viewport);
      } catch {
        // A scanned page without selectable text retains its physical PDF position.
      }
      if (nextPageToScan % 8 === 0 || nextPageToScan === pdf.numPages) {
        renderLabels(mergedPageTabLabels(pdf.numPages, null, counters));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } finally {
    renderLabels(mergedPageTabLabels(pdf.numPages, null, counters));
    scanRunning = false;
  }
}

function updateVisibility() {
  const visible = isVisible();
  rail.setAttribute("aria-hidden", String(!visible));
  rail.inert = !visible;
  if (visible) {
    keepSelectedTabVisible(tabs[selectedPage - 1]);
    void scanVisiblePageNumbers();
  }
}

window.addEventListener("pdf-viewer-page-changed", (event) => selectPage(event.detail?.pageNumber));
window.addEventListener("pdf-viewer-page-tabs-mode-change", updateVisibility);
window.addEventListener("resize", updateVisibility);
rail.addEventListener("click", (event) => {
  const tab = event.target.closest(".page-tab");
  if (tab && rail.contains(tab)) navigateToPage(Number(tab.dataset.page));
});
rail.addEventListener("keydown", (event) => {
  const tab = event.target.closest(".page-tab");
  if (!tab) return;
  const page = Number(tab.dataset.page);
  const target = event.key === "ArrowUp" ? page - 1 :
    event.key === "ArrowDown" ? page + 1 :
    event.key === "Home" ? 1 : event.key === "End" ? tabs.length : null;
  if (target === null || target < 1 || target > tabs.length) return;
  event.preventDefault();
  tabs[target - 1].focus();
  navigateToPage(target);
});

async function initialize() {
  documentSession = await pdfDocumentSessionReady;
  if (!documentSession) return;
  const pdf = documentSession.document;
  counters = new Array(pdf.numPages).fill(null);
  const fragment = document.createDocumentFragment();
  tabs = Array.from({ length: pdf.numPages }, (_, index) => {
    const tab = document.createElement("button");
    tab.className = "page-tab";
    tab.type = "button";
    tab.dataset.page = String(index + 1);
    fragment.append(tab);
    return tab;
  });
  rail.replaceChildren(fragment);
  renderLabels(mergedPageTabLabels(pdf.numPages));
  selectPage(Number(pageInput.value) || 1);
  updateVisibility();
  try {
    embeddedLabels = await pdf.getPageLabels();
  } catch {
    embeddedLabels = null;
  }
  if (Array.isArray(embeddedLabels) && embeddedLabels.length === pdf.numPages &&
    embeddedLabels.every((label) => typeof label === "string" && label.trim())) {
    renderLabels(mergedPageTabLabels(pdf.numPages, embeddedLabels));
  } else {
    embeddedLabels = null;
  }
  metadataLoaded = true;
  void scanVisiblePageNumbers();
}
void initialize();
