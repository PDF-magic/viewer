import {
  formatSelectionNotes, normalizeNoteQuote, notesStorageKey,
  resolveNoteOffsets, selectionNotesFilename,
} from "./selection-notes-model.js";
import { pdfDocumentSessionReady } from "../pdf-document-session.js";

const viewer = document.querySelector("#viewer");
const actionBar = document.querySelector("#selection-note-actions");
const addButton = document.querySelector("#selection-note-add");
const editor = document.querySelector("#selection-note-editor");
const quoteElement = document.querySelector("#selection-note-quote");
const input = document.querySelector("#selection-note-text");
const status = document.querySelector("#selection-note-status");
const saveButton = document.querySelector("#selection-note-save");
const deleteButton = document.querySelector("#selection-note-delete");
const cancelButton = document.querySelector("#selection-note-cancel");
const exportButton = document.querySelector("#export-selection-notes");

let key = null;
let notes = [];
let draft = null;
let dragging = false;
let refreshFrame = 0;
let anchoredRanges = [];
const HIGHLIGHT_NAME = "pdf-selection-notes";

function textNodes(layer) {
  const nodes = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest(".text-layer span:not([role='img'])") && node.length) {
      nodes.push(node);
    }
  }
  return nodes;
}

function textPosition(nodes, node, offset) {
  let position = 0;
  for (const entry of nodes) {
    if (entry === node) return position + offset;
    position += entry.length;
  }
  return null;
}

function positionNode(nodes, offset) {
  let remaining = offset;
  for (const node of nodes) {
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
  }
  const last = nodes.at(-1);
  return last && remaining === 0 ? { node: last, offset: last.length } : null;
}

function rangeFromNote(layer, note) {
  const nodes = textNodes(layer);
  if (!nodes.length) return null;
  const text = nodes.map(node => node.textContent).join("");
  const offsets = resolveNoteOffsets(text, note);
  if (!offsets) return null;
  const start = positionNode(nodes, offsets.start);
  const end = positionNode(nodes, offsets.end);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function selectionSnapshot() {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const startLayer = range.startContainer.parentElement?.closest(".text-layer");
  const endLayer = range.endContainer.parentElement?.closest(".text-layer");
  if (!startLayer || startLayer !== endLayer) return null;
  const page = Number(startLayer.closest(".page")?.dataset.page);
  if (!Number.isInteger(page) || page < 1) return null;
  const nodes = textNodes(startLayer);
  const start = textPosition(nodes, range.startContainer, range.startOffset);
  const end = textPosition(nodes, range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end) return null;
  const raw = nodes.map(node => node.textContent).join("").slice(start, end);
  const quote = normalizeNoteQuote(selection.toString()) || normalizeNoteQuote(raw);
  if (!raw.trim() || !quote) return null;
  const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
  if (!rects.length) return null;
  return { page, start, end, raw, quote, rect: rects.at(-1) };
}

function placePopup(element, rect) {
  const width = element === editor ? 340 : 112;
  const height = element === editor ? 275 : 42;
  element.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width / 2)) + "px";
  const below = rect.bottom + 7;
  element.style.top = (below + height < window.innerHeight
    ? below : Math.max(8, rect.top - height - 7)) + "px";
}

function hideAction() {
  actionBar.hidden = true;
}

function showSelectionAction() {
  if (!editor.hidden || dragging || !key) return;
  const selected = selectionSnapshot();
  if (!selected) {
    hideAction();
    return;
  }
  draft = { ...selected, id: null, text: "" };
  placePopup(actionBar, selected.rect);
  actionBar.hidden = false;
}

function loadNotes() {
  try {
    const values = JSON.parse(localStorage.getItem(key) || "[]");
    notes = Array.isArray(values) ? values.filter(item =>
      typeof item?.id === "string" && Number.isInteger(item.page) && item.page > 0 &&
      Number.isInteger(item.start) && item.start >= 0 &&
      Number.isInteger(item.end) && item.end > item.start &&
      typeof item.raw === "string" && item.raw.length > 0 &&
      typeof item.text === "string" && typeof item.quote === "string") : [];
  } catch {
    notes = [];
  }
  updateExportButton();
  scheduleHighlights();
}

function updateExportButton() {
  exportButton.disabled = notes.length === 0;
  exportButton.title = notes.length
    ? "Export " + notes.length + " notes as plain text"
    : "No notes to export";
}

function persist(next) {
  try {
    localStorage.setItem(key, JSON.stringify(next));
    notes = next;
    updateExportButton();
    scheduleHighlights();
    return true;
  } catch {
    status.textContent = "Could not save notes to local storage.";
    return false;
  }
}

function openEditor(selection) {
  draft = selection;
  input.value = selection.text || "";
  quoteElement.textContent = selection.quote;
  deleteButton.hidden = !selection.id;
  status.textContent = "";
  hideAction();
  placePopup(editor, selection.rect);
  editor.hidden = false;
  input.focus();
}

function closeEditor() {
  editor.hidden = true;
  draft = null;
  status.textContent = "";
  document.getSelection()?.removeAllRanges();
}

function refreshHighlights() {
  refreshFrame = 0;
  anchoredRanges = [];
  for (const layer of viewer.querySelectorAll(".page .text-layer")) {
    const page = Number(layer.closest(".page")?.dataset.page);
    for (const note of notes) {
      if (note.page !== page) continue;
      const range = rangeFromNote(layer, note);
      if (range) anchoredRanges.push({ note, range });
    }
  }
  if (globalThis.CSS?.highlights && typeof Highlight === "function") {
    if (anchoredRanges.length) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...anchoredRanges.map(item => item.range)));
    } else {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }
  }
}

function scheduleHighlights() {
  if (!refreshFrame) refreshFrame = requestAnimationFrame(refreshHighlights);
}

function editNoteAtPoint(event) {
  if (!editor.hidden || !key || !event.target.closest(".text-layer") ||
      event.target.closest("a, button") || !document.getSelection()?.isCollapsed) return;
  const hit = anchoredRanges.find(({ range }) => [...range.getClientRects()].some(rect =>
    event.clientX >= rect.left - 2 && event.clientX <= rect.right + 2 &&
    event.clientY >= rect.top - 2 && event.clientY <= rect.bottom + 2));
  if (!hit) return;
  event.preventDefault();
  const rects = [...hit.range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
  if (rects.length) openEditor({ ...hit.note, rect: rects.at(-1) });
}

addButton.addEventListener("pointerdown", event => event.preventDefault());
addButton.addEventListener("mousedown", event => event.preventDefault());
addButton.addEventListener("click", () => {
  const selected = draft?.id ? null : selectionSnapshot();
  if (selected) openEditor({ ...selected, id: null, text: "" });
});

cancelButton.addEventListener("click", closeEditor);
saveButton.addEventListener("click", () => {
  const text = input.value.trim();
  if (!draft || !text) {
    status.textContent = "Enter a note before saving.";
    return;
  }
  const { rect, ...entry } = draft;
  const item = { ...entry, id: entry.id || crypto.randomUUID(), text };
  const next = entry.id ? notes.map(note => note.id === entry.id ? item : note) : [...notes, item];
  if (persist(next)) closeEditor();
});
deleteButton.addEventListener("click", () => {
  if (draft?.id && persist(notes.filter(note => note.id !== draft.id))) closeEditor();
});
editor.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    event.stopPropagation();
    closeEditor();
  }
});

exportButton.addEventListener("click", () => {
  if (!notes.length) return;
  const params = new URLSearchParams(window.location.search);
  const source = params.get("url") || "";
  const content = formatSelectionNotes(notes, document.title, source);
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = selectionNotesFilename(document.title);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.addEventListener("pointerdown", event => {
  dragging = Boolean(event.target.closest?.(".text-layer"));
  if (!event.target.closest?.("#selection-note-actions, #selection-note-editor")) hideAction();
});
document.addEventListener("pointerup", () => {
  dragging = false;
  setTimeout(showSelectionAction, 0);
});
document.addEventListener("keyup", event => {
  if (event.key === "Escape" && editor.hidden) hideAction();
  else showSelectionAction();
});
document.addEventListener("selectionchange", () => {
  if (!dragging && editor.hidden) showSelectionAction();
});
viewer.addEventListener("click", editNoteAtPoint);
window.addEventListener("scroll", () => {
  if (editor.hidden) hideAction();
}, { passive: true });
window.addEventListener("resize", () => {
  if (editor.hidden) hideAction();
  scheduleHighlights();
});

const observer = new MutationObserver(mutations => {
  if (mutations.some(({ target, addedNodes, removedNodes }) =>
    target instanceof Element && (target.closest(".text-layer") ||
      [...addedNodes, ...removedNodes].some(node => node instanceof Element &&
        (node.matches(".text-layer, .page") || node.querySelector(".text-layer")))))) {
    scheduleHighlights();
  }
});
observer.observe(viewer, { childList: true, subtree: true });

pdfDocumentSessionReady.then(session => {
  if (!session?.document) return;
  const params = new URLSearchParams(window.location.search);
  key = notesStorageKey(session.fingerprint, params.get("url") || window.location.href.split("#")[0]);
  loadNotes();
  window.addEventListener("storage", event => {
    if (event.key === key) loadNotes();
  });
});
