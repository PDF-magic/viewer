import { pdfDocumentSessionReady } from "../pdf-document-session.js";
import { footnotesForPage } from "./footnote-index.js";
import { scrollToTarget } from "./footnote-jump.js";

const scrubber = document.querySelector("#document-scrubber");
const range = document.querySelector("#document-scrubber-range");
const currentLabel = document.querySelector("#document-scrubber-current");
const startLabel = document.querySelector("#document-scrubber-start");
const endLabel = document.querySelector("#document-scrubber-end");
const preview = document.querySelector("#document-scrubber-preview");
const track = document.querySelector(".document-scrubber-track");

let notes = [];
let navigationFrame;
let trackingFrame;
let pendingIndex = 0;
let dragging = false;
let editingNumber = false;

function clampIndex(value) {
  return Math.min(Math.max((Number.parseInt(value, 10) || 1) - 1, 0), notes.length - 1);
}

function previewNote(index) {
  const note = notes[index];
  if (!note) return;
  const text = `Note ${note.number} at ${note.pageNumber}\n${note.text}`;
  if (preview.textContent !== text) {
    preview.textContent = text;
    preview.scrollTop = 0;
  }
}

function updateScrubber(index) {
  const note = notes[index];
  if (!note) return;
  const progress = notes.length > 1 ? index / (notes.length - 1) : 0;
  range.value = String(index + 1);
  range.setAttribute("aria-valuetext", `Footnote ${note.number}, ${index + 1} of ${notes.length}, page ${note.pageNumber}: ${note.text}`);
  if (!editingNumber) currentLabel.value = String(note.number);
  track.style.setProperty("--scrubber-progress", String(progress));
  // Match the native thumb's center, including its radius at both endpoints.
  track.style.setProperty("--scrubber-thumb-x", `${7 + progress * Math.max(0, track.clientWidth - 14)}px`);
  previewNote(index);
}

function navigateToFootnote(value) {
  pendingIndex = clampIndex(value);
  updateScrubber(pendingIndex);
  if (navigationFrame) return;
  navigationFrame = requestAnimationFrame(() => {
    navigationFrame = undefined;
    scrollToTarget(notes[pendingIndex]);
  });
}

function trackPosition() {
  if (!notes.length || dragging || navigationFrame || editingNumber) return;
  const toolbarHeight = document.querySelector(".toolbar")?.getBoundingClientRect().height || 52;
  const y = toolbarHeight + (window.innerHeight - toolbarHeight - scrubber.getBoundingClientRect().height) / 2;
  const page = document.elementFromPoint(window.innerWidth / 2, y)?.closest(".page");
  if (!page) return;
  const pageNumber = Number(page.dataset.page);
  const rect = page.getBoundingClientRect();
  const yRatio = (y - rect.top) / Math.max(1, rect.height);
  // Allow for the superscript baseline and rounded rendered page dimensions.
  const markerTolerance = 8 / Math.max(1, rect.height);
  let index = 0;
  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    if (note.pageNumber > pageNumber || (note.pageNumber === pageNumber && note.yRatio > yRatio + markerTolerance)) break;
    index = i;
  }
  updateScrubber(index);
}

function scheduleTracking() {
  if (trackingFrame || !notes.length) return;
  trackingFrame = requestAnimationFrame(() => {
    trackingFrame = undefined;
    trackPosition();
  });
}

currentLabel?.addEventListener("focus", () => {
  editingNumber = true;
  currentLabel.select();
});
currentLabel?.addEventListener("click", () => currentLabel.select());
currentLabel?.addEventListener("input", () => currentLabel.setCustomValidity(""));
currentLabel?.addEventListener("blur", () => {
  editingNumber = false;
  currentLabel.setCustomValidity("");
  updateScrubber(clampIndex(range.value));
  scheduleTracking();
});
currentLabel?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    currentLabel.blur();
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const rawNumber = currentLabel.value.trim();
  const number = /^\d+$/.test(rawNumber) ? Number(rawNumber) : NaN;
  const currentIndex = clampIndex(range.value);
  let targetIndex = -1;
  for (let index = 0; index < notes.length; index += 1) {
    if (notes[index].number === number && (targetIndex < 0 ||
      Math.abs(index - currentIndex) < Math.abs(targetIndex - currentIndex))) targetIndex = index;
  }
  if (targetIndex < 0) {
    currentLabel.setCustomValidity("Enter a footnote number found in this document.");
    currentLabel.reportValidity();
    return;
  }
  editingNumber = false;
  navigateToFootnote(targetIndex + 1);
  currentLabel.blur();
});

range?.addEventListener("input", () => navigateToFootnote(range.value));
range?.addEventListener("change", () => navigateToFootnote(range.value));
range?.addEventListener("pointerdown", () => { dragging = true; });
window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("pointercancel", () => { dragging = false; });
track?.addEventListener("pointermove", (event) => {
  if (preview.contains(event.target)) return;
  const rect = track.getBoundingClientRect();
  track.style.setProperty("--scrubber-preview-x", `${event.clientX - rect.left}px`);
});
track?.addEventListener("pointerleave", () => {
  track.style.removeProperty("--scrubber-preview-x");
  previewNote(clampIndex(range.value));
});
range?.addEventListener("pointermove", (event) => {
  if (dragging) return;
  const rect = range.getBoundingClientRect();
  const progress = Math.min(1, Math.max(0, (event.clientX - rect.left - 7) / Math.max(1, rect.width - 14)));
  previewNote(Math.round(progress * (notes.length - 1)));
});
window.addEventListener("scroll", scheduleTracking, { passive: true });
window.addEventListener("resize", () => {
  updateScrubber(clampIndex(range.value));
  scheduleTracking();
});

async function initializeScrubber() {
  const session = await pdfDocumentSessionReady;
  if (!session?.document) return;
  // Only retain compact note metadata; yield between pages so rendering can continue.
  for (let pageNumber = 1; pageNumber <= session.document.numPages; pageNumber += 1) {
    try {
      const page = await session.document.getPage(pageNumber);
      const content = await page.getTextContent();
      notes.push(...footnotesForPage(content.items, page.getViewport({ scale: 1 }), pageNumber));
    } catch (error) {
      console.warn(`Could not index footnotes on page ${pageNumber}`, error);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!notes.length) return;
  range.max = String(notes.length);
  startLabel.textContent = String(notes[0].number);
  endLabel.textContent = String(notes.at(-1).number);
  endLabel.title = `${notes.length} footnotes`;
  scrubber.hidden = false;
  document.documentElement.style.setProperty("--document-scrubber-height", "28px");
  updateScrubber(0);
  scheduleTracking();
}

void initializeScrubber();
