import { appendFootnotesForPage } from "./footnote-index.js";
import { crossReferencedFootnotes } from "./footnote-cross-references.js";
import { pdfDocumentSessionReady } from "../pdf-document-session.js";

const openButton = document.querySelector("#cross-reference-notes");
const dialog = document.querySelector("#cross-reference-dialog");
const closeButton = document.querySelector("#cross-reference-close");
const copyButton = document.querySelector("#cross-reference-copy");
const status = document.querySelector("#cross-reference-status");
const list = document.querySelector("#cross-reference-list");

let indexPromise;
let matches;

function setStatus(message) {
  status.textContent = message;
}

function goToNote(note) {
  dialog.close();
  window.dispatchEvent(new CustomEvent("pdf-viewer-footnote-jump", {
    detail: { ...note, searchResult: true },
  }));
}

function noteButton(note, label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => goToNote(note));
  return button;
}

function renderMatches(rows) {
  list.replaceChildren();
  copyButton.disabled = rows.length === 0;
  const count = rows.reduce((total, row) => total + row.references.length, 0);
  setStatus(rows.length
    ? `${rows.length} footnotes contain ${count} cross-references.`
    : "No explicit cross-footnote references found in recognized footnotes.");

  for (const { source, references } of rows) {
    const item = document.createElement("li");
    item.className = "cross-reference-entry";
    const header = document.createElement("div");
    header.className = "cross-reference-entry-header";
    header.append(noteButton(source, `Note ${source.number} · page ${source.pageNumber}`, "cross-reference-source"));

    const targets = document.createElement("div");
    targets.className = "cross-reference-targets";
    for (const { direction, number, target } of references) {
      const label = `${direction} note ${number}`;
      if (target) {
        const button = noteButton(target, `${label} → page ${target.pageNumber}`, "cross-reference-target");
        button.title = `Jump to ${label} on page ${target.pageNumber}`;
        targets.append(button);
      } else {
        const unresolved = document.createElement("span");
        unresolved.className = "cross-reference-unresolved";
        unresolved.textContent = `${label} · not found`;
        unresolved.title = "No matching note was recognized in the cited direction";
        targets.append(unresolved);
      }
    }

    const text = document.createElement("p");
    text.className = "cross-reference-text";
    text.textContent = source.text;
    item.append(header, text, targets);
    list.append(item);
  }
}

async function collectMatches() {
  const session = await pdfDocumentSessionReady;
  if (!session?.document) throw new Error("PDF is not ready");
  const notes = [];
  let previous;
  for (let pageNumber = 1; pageNumber <= session.document.numPages; pageNumber += 1) {
    const page = await session.document.getPage(pageNumber);
    try {
      const [text, operatorList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      const viewport = page.getViewport({ scale: 1 });
      appendFootnotesForPage(notes, text.items, viewport, pageNumber, operatorList, session.operators, previous);
      previous = { items: text.items, viewport };
    } finally {
      page.cleanup();
    }
    if (pageNumber === 1 || pageNumber % 10 === 0 || pageNumber === session.document.numPages) {
      setStatus(`Scanning footnotes… ${pageNumber} / ${session.document.numPages} pages`);
    }
  }
  return crossReferencedFootnotes(notes);
}

async function showCrossReferences() {
  // Keep the viewer toolbar and its popover in sync when opening a dialog.
  document.querySelector("#tools-menu").hidden = true;
  document.querySelector("#tools-button").setAttribute("aria-expanded", "false");
  dialog.showModal();
  if (matches) {
    renderMatches(matches);
    return;
  }
  setStatus("Scanning footnotes…");
  if (!indexPromise) indexPromise = collectMatches();
  try {
    matches = await indexPromise;
    renderMatches(matches);
  } catch (error) {
    indexPromise = null; // Retry is possible on the next open.
    setStatus(`Could not scan footnotes: ${error?.message || error}`);
  }
}

openButton?.addEventListener("click", () => void showCrossReferences());
closeButton?.addEventListener("click", () => dialog.close());
copyButton?.addEventListener("click", async () => {
  if (!matches?.length) return;
  const text = matches.map(({ source, references }) =>
    `Note ${source.number} (page ${source.pageNumber})\n${source.text}\n` +
    references.map(({ direction, number, target }) =>
      `  ${direction} note ${number}: ${target ? `page ${target.pageNumber}` : "not found"}`).join("\n"),
  ).join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "Copied!";
    copyButton.focus();
  } catch {
    setStatus("Could not copy the list to the clipboard.");
  }
});
dialog?.addEventListener("close", () => {
  copyButton.textContent = "Copy list";
});
