import { pdfDocumentSessionReady } from "../pdf-document-session.js";

const viewer = document.querySelector("#viewer");
const scrubber = document.querySelector("#document-scrubber");
const range = document.querySelector("#document-scrubber-range");
const currentLabel = document.querySelector("#document-scrubber-current");
const endLabel = document.querySelector("#document-scrubber-end");
const pageNumberInput = document.querySelector("#page-number");

let totalPages = 1;
let navigationFrame;
let trackingFrame;
let pendingPage = 1;

function clampPage(value) {
  const page = Number.parseInt(String(value), 10) || 1;
  return Math.min(Math.max(page, 1), totalPages);
}

function updateScrubber(pageNumber) {
  const page = clampPage(pageNumber);
  const progress = totalPages > 1 ? (page - 1) / (totalPages - 1) : 0;

  range.value = String(page);
  range.setAttribute("aria-valuetext", `Page ${page} of ${totalPages}`);
  currentLabel.value = String(page);
  currentLabel.textContent = String(page);
  scrubber.style.setProperty("--scrubber-progress", String(progress));
  document.querySelector(".document-scrubber-track")?.style.setProperty(
    "--scrubber-progress",
    String(progress),
  );
}

function flushNavigation() {
  navigationFrame = undefined;
  const page = clampPage(pendingPage);

  updateScrubber(page);
  pageNumberInput.value = String(page);
  pageNumberInput.dispatchEvent(new Event("change", { bubbles: true }));
}

function navigateToPage(pageNumber) {
  pendingPage = clampPage(pageNumber);
  updateScrubber(pendingPage);

  if (!navigationFrame) {
    navigationFrame = requestAnimationFrame(flushNavigation);
  }
}

function pageAtViewportCenter() {
  const toolbarHeight = document.querySelector(".toolbar")?.getBoundingClientRect().height || 52;
  const scrubberHeight = scrubber?.getBoundingClientRect().height || 44;
  const readableHeight = Math.max(1, window.innerHeight - toolbarHeight - scrubberHeight);
  const y = toolbarHeight + readableHeight / 2;
  const target = document.elementFromPoint(window.innerWidth / 2, y)?.closest(".page");

  return target?.dataset.page ? clampPage(target.dataset.page) : null;
}

function scheduleTracking() {
  if (trackingFrame) {
    return;
  }

  trackingFrame = requestAnimationFrame(() => {
    trackingFrame = undefined;
    const page = pageAtViewportCenter();
    if (page !== null) {
      updateScrubber(page);
    }
  });
}

range?.addEventListener("input", () => navigateToPage(range.value));
range?.addEventListener("change", () => navigateToPage(range.value));

window.addEventListener("scroll", scheduleTracking, { passive: true });
window.addEventListener("resize", scheduleTracking);

const pageObserver = new MutationObserver(scheduleTracking);
if (viewer) {
  pageObserver.observe(viewer, { childList: true });
}

async function initializeScrubber() {
  const session = await pdfDocumentSessionReady;
  if (!session?.document) {
    scrubber.hidden = true;
    return;
  }

  totalPages = Math.max(1, session.document.numPages);
  range.max = String(totalPages);
  endLabel.textContent = String(totalPages);
  updateScrubber(pageNumberInput?.value || 1);
  scheduleTracking();
}

void initializeScrubber();
