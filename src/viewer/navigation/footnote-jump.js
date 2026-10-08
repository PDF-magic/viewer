import { appendFootnotesForPage, candidateForPage } from "./footnote-index.js";
import { pdfDocumentSessionReady } from "../pdf-document-session.js";

const form = document.querySelector("#footnote-jump");
const footnoteInput = document.querySelector("#footnote-number");
const status = document.querySelector("#footnote-jump-status");
const pageNumberInput = document.querySelector("#page-number");

const pageCache = new Map();
let lookupRequestId = 0;

function currentPageNumber() {
  return Math.max(1, Number.parseInt(pageNumberInput?.value, 10) || 1);
}

function setStatus(message, state = "") {
  if (!status) {
    return;
  }

  status.textContent = message;
  if (state) {
    status.dataset.state = state;
  } else {
    delete status.dataset.state;
  }
}

async function pageData(pdfDocument, pageNumber) {
  if (pageCache.has(pageNumber)) {
    return pageCache.get(pageNumber);
  }

  const page = await pdfDocument.getPage(pageNumber);
  const [textContent, viewport, operatorList] = await Promise.all([
    page.getTextContent(),
    Promise.resolve(page.getViewport({ scale: 1 })),
    page.getOperatorList(),
  ]);
  const data = { items: textContent.items, viewport, operatorList };
  pageCache.set(pageNumber, data);
  page.cleanup();
  return data;
}

async function findFootnoteTarget(pdfDocument, number, originPage, requestId, operators) {
  let best;
  const notes = [];
  let previous;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (requestId !== lookupRequestId) {
      return null;
    }

    const { items, viewport, operatorList } = await pageData(pdfDocument, pageNumber);
    appendFootnotesForPage(notes, items, viewport, pageNumber, operatorList, operators, previous);
    previous = { items, viewport };
    const candidate = candidateForPage(items, viewport, number, pageNumber, originPage);
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate;
    }
  }

  return notes.filter(note => note.number === number).sort((a, b) =>
    Math.abs(a.pageNumber - originPage) - Math.abs(b.pageNumber - originPage))[0] || best || null;
}

function scrollToTarget(target, searchResult = false) {
  window.dispatchEvent(new CustomEvent("pdf-viewer-footnote-jump", {
    detail: { ...target, searchResult },
  }));
}

async function jumpToFootnote(rawNumber, originPage = currentPageNumber()) {
  const number = Number.parseInt(String(rawNumber).trim(), 10);
  if (!Number.isSafeInteger(number) || number <= 0) {
    setStatus("Enter a footnote number", "error");
    footnoteInput?.focus();
    footnoteInput?.select();
    return;
  }

  const requestId = ++lookupRequestId;
  setStatus(`Finding footnote ${number}…`, "searching");

  const session = await pdfDocumentSessionReady;
  if (requestId !== lookupRequestId) {
    return;
  }

  if (!session?.document) {
    setStatus("PDF is not ready", "error");
    return;
  }

  const target = await findFootnoteTarget(
    session.document,
    number,
    originPage,
    requestId,
    session.operators,
  );
  if (requestId !== lookupRequestId) {
    return;
  }

  if (!target) {
    setStatus(`Footnote ${number} not found`, "error");
    return;
  }

  scrollToTarget(target, true);
  setStatus(`Footnote ${number} · page ${target.pageNumber}`, "success");
}

window.addEventListener("pdf-viewer-inline-footnote-jump", (event) => {
  const { number, originPage } = event.detail || {};
  if (Number.isSafeInteger(number) && number > 0) {
    void jumpToFootnote(number, Number.isSafeInteger(originPage) ? originPage : currentPageNumber());
  }
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void jumpToFootnote(footnoteInput?.value || "");
});

footnoteInput?.addEventListener("click", () => {
  footnoteInput.select();
});

footnoteInput?.addEventListener("input", () => {
  setStatus("");
});

export { scrollToTarget };
