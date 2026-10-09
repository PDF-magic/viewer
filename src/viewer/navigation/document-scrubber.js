import { pdfDocumentSessionReady } from "../pdf-document-session.js";
import { appendFootnotesForPage } from "./footnote-index.js";
import { scrollToTarget } from "./footnote-jump.js";

const scrubber = document.querySelector("#document-scrubber");
const range = document.querySelector("#document-scrubber-range");
const currentLabel = document.querySelector("#document-scrubber-current");
const preview = document.querySelector("#document-scrubber-preview");
const track = document.querySelector(".document-scrubber-track");

let notes = [];
let navigationFrame;
let trackingFrame;
let pendingIndex = 0;
let pendingSearchResult = false;
let dragging = false;
let editingNumber = false;
let choosingOccurrence = false;
let selectedIndex = -1;
let visualProgress = 0;
let motionFrame;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function paintProgress(progress) {
  visualProgress = progress;
  const width = Math.max(0, track.clientWidth - 14);
  const target = notes.length > 1 ? selectedIndex / (notes.length - 1) : 0;
  track.style.setProperty("--scrubber-progress", String(progress));
  track.style.setProperty("--scrubber-thumb-x", `${7 + progress * width}px`);
  track.style.setProperty("--scrubber-thumb-offset", `${(progress - target) * width}px`);
}

function moveProgress(target, smooth) {
  if (motionFrame) cancelAnimationFrame(motionFrame);
  motionFrame = undefined;
  if (!smooth || reducedMotion.matches) {
    paintProgress(target);
    return;
  }
  const start = visualProgress;
  const started = performance.now();
  // Retarget from the visible position so rapid page changes never restart at
  // an old footnote. Direct slider/keyboard navigation stays immediate.
  paintProgress(start);
  function animate(now) {
    const elapsed = Math.min(1, (now - started) / 160);
    const eased = 1 - (1 - elapsed) ** 3;
    paintProgress(start + (target - start) * eased);
    motionFrame = elapsed < 1 ? requestAnimationFrame(animate) : undefined;
  }
  motionFrame = requestAnimationFrame(animate);
}

function clampIndex(value) {
  return Math.min(Math.max((Number.parseInt(value, 10) || 1) - 1, 0), notes.length - 1);
}

function previewNote(index) {
  const note = notes[index];
  if (!note || choosingOccurrence) return;
  const text = `Note ${note.number} at ${note.pageNumber}\n${note.text}`;
  if (preview.textContent !== text) {
    preview.textContent = text;
    preview.scrollTop = 0;
  }
}

function sizeCurrentNumber() {
  const digits = Math.max(2, currentLabel.value.length);
  scrubber.style.setProperty("--scrubber-number-width", `calc(${digits}ch + 12px)`);
}

function updateScrubber(index, smooth = false) {
  const note = notes[index];
  if (!note) return;
  if (smooth && index === selectedIndex) return;
  selectedIndex = index;
  const progress = notes.length > 1 ? index / (notes.length - 1) : 0;
  range.value = String(index + 1);
  range.setAttribute("aria-valuetext", `Footnote ${note.number}, ${index + 1} of ${notes.length}, page ${note.pageNumber}: ${note.text}`);
  if (!editingNumber) currentLabel.value = String(note.number);
  sizeCurrentNumber();
  moveProgress(progress, smooth);
  previewNote(index);
}

function navigateToFootnote(value, searchResult = false) {
  pendingIndex = clampIndex(value);
  pendingSearchResult = searchResult;
  updateScrubber(pendingIndex);
  if (navigationFrame) return;
  navigationFrame = requestAnimationFrame(() => {
    navigationFrame = undefined;
    scrollToTarget(notes[pendingIndex], pendingSearchResult);
  });
}

function closeChoices() {
  choosingOccurrence = false;
  preview.setAttribute("role", "tooltip");
  preview.removeAttribute("aria-label");
  preview.classList.remove("document-scrubber-choices");
  currentLabel.setAttribute("aria-expanded", "false");
  previewNote(clampIndex(range.value));
}

function chooseOccurrence(index) {
  closeChoices();
  editingNumber = false;
  navigateToFootnote(index + 1, true);
  currentLabel.blur();
}

function showChoices(number, matches) {
  choosingOccurrence = true;
  preview.replaceChildren();
  preview.setAttribute("role", "group");
  preview.setAttribute("aria-label", `Footnote ${number} occurrences`);
  preview.classList.add("document-scrubber-choices");
  currentLabel.setAttribute("aria-expanded", "true");
  const heading = document.createElement("div");
  heading.textContent = `Footnote ${number} · ${matches.length} matches`;
  preview.append(heading);
  for (const index of matches) {
    const note = notes[index];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "document-scrubber-choice";
    button.textContent = `Page ${note.pageNumber}\n${note.text}`;
    button.addEventListener("click", () => chooseOccurrence(index));
    preview.append(button);
  }
  preview.scrollTop = 0;
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
  const selected = clampIndex(range.value);
  if (notes[selected]?.pageNumber === pageNumber && Math.abs(notes[selected].yRatio - yRatio) <= markerTolerance) return;
  let index = 0;
  let distance = Infinity;
  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    if (note.pageNumber > pageNumber) break;
    if (note.pageNumber < pageNumber) { index = i; continue; }
    const delta = Math.abs(note.yRatio - yRatio);
    if (delta < distance) { distance = delta; index = i; }
  }
  updateScrubber(index, true);
}

reducedMotion.addEventListener("change", () => {
  if (selectedIndex >= 0) updateScrubber(selectedIndex);
});

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
currentLabel?.addEventListener("input", () => {
  sizeCurrentNumber();
  currentLabel.setCustomValidity("");
  if (choosingOccurrence) closeChoices();
});
currentLabel?.addEventListener("blur", (event) => {
  if (choosingOccurrence && preview.contains(event?.relatedTarget)) return;
  if (choosingOccurrence) closeChoices();
  editingNumber = false;
  currentLabel.setCustomValidity("");
  updateScrubber(clampIndex(range.value));
  scheduleTracking();
});
currentLabel?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    if (choosingOccurrence) closeChoices();
    currentLabel.blur();
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const rawNumber = currentLabel.value.trim();
  const number = /^\d+$/.test(rawNumber) ? Number(rawNumber) : NaN;
  const matches = [];
  for (let index = 0; index < notes.length; index += 1) {
    if (notes[index].number === number) matches.push(index);
  }
  if (matches.length > 1) {
    currentLabel.setCustomValidity("");
    showChoices(number, matches);
    return;
  }
  const targetIndex = matches[0] ?? -1;
  if (targetIndex < 0) {
    currentLabel.setCustomValidity("Enter a footnote number found in this document.");
    currentLabel.reportValidity();
    return;
  }
  editingNumber = false;
  navigateToFootnote(targetIndex + 1, true);
  currentLabel.blur();
});

preview?.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !choosingOccurrence) return;
  event.preventDefault();
  closeChoices();
  editingNumber = false;
  updateScrubber(clampIndex(range.value));
  currentLabel.focus();
});
track?.addEventListener("focusout", (event) => {
  if (!choosingOccurrence || track.contains(event.relatedTarget)) return;
  closeChoices();
  editingNumber = false;
  updateScrubber(clampIndex(range.value));
  scheduleTracking();
});

range?.addEventListener("input", () => {
  if (choosingOccurrence) closeChoices();
  editingNumber = false;
  navigateToFootnote(range.value);
});
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

function publishFootnoteIndex(index) {
  if (!index.length) return;
  const selected = notes[selectedIndex];
  notes = index;
  const matchingIndex = selected ? notes.findIndex(note =>
    note.number === selected.number && note.pageNumber === selected.pageNumber) : -1;
  range.max = String(notes.length);
  scrubber.hidden = false;
  document.documentElement.style.setProperty("--document-scrubber-height", "28px");
  updateScrubber(matchingIndex >= 0 ? matchingIndex : 0);
  scheduleTracking();
}

async function initializeScrubber() {
  const session = await pdfDocumentSessionReady;
  if (!session?.document) return;
  // Text extraction is cheap even for large scans. Publish those notes first;
  // drawing operators may decode hundreds of large scanned page images.
  // Refine the index with separator rules in a second pass.
  for (const includeOperators of [false, true]) {
    const index = [];
    let previousPageText;
    for (let pageNumber = 1; pageNumber <= session.document.numPages; pageNumber += 1) {
      try {
        const page = await session.document.getPage(pageNumber);
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        const operators = includeOperators ? await page.getOperatorList().catch(() => null) : null;
        appendFootnotesForPage(index, content.items, viewport, pageNumber, operators, session.operators, previousPageText);
        previousPageText = { items: content.items, viewport };
        // Keep the text index available while the refined index is incomplete.
        if (!includeOperators || !notes.length) publishFootnoteIndex(index);
      } catch (error) {
        previousPageText = undefined;
        console.warn(`Could not index footnotes on page ${pageNumber}`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    publishFootnoteIndex(index);
  }
}

void initializeScrubber();
