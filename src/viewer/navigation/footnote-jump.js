import { appendFootnotesForPage, candidateForPage, footnoteRulesForPage } from "./footnote-index.js";
import { pdfDocumentSessionReady } from "../pdf-document-session.js";
import { footnoteToMarkdown } from "../selection/markdown-copy.js";

const pageNumberInput = document.querySelector("#page-number");

let lookupRequestId = 0;

function currentPageNumber() {
  return Math.max(1, Number.parseInt(pageNumberInput?.value, 10) || 1);
}

function reportFootnoteError(message) {
  window.dispatchEvent(new CustomEvent("pdf-viewer-toast", { detail: { message } }));
}

async function pageData(pdfDocument, pageNumber, operators) {
  const page = await pdfDocument.getPage(pageNumber);
  try {
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const operatorList = await page.getOperatorList();
    // Retain only text and separator geometry, never drawing instructions or
    // their embedded image buffers. A lookup streams through one page at a time.
    return { items: textContent.items, viewport, rules: footnoteRulesForPage(operatorList, viewport, operators) };
  } finally {
    page.cleanup();
  }
}

async function findFootnoteTarget(pdfDocument, number, originPage, requestId, operators) {
  // A complete, confidently indexed note on the current page is already the
  // closest match. Avoid decoding every scanned page just to find it again.
  const origin = await pdfDocument.getPage(originPage);
  let originItems;
  try {
    ({ items: originItems } = await origin.getTextContent());
  } finally {
    origin.cleanup();
  }
  if (requestId !== lookupRequestId) return null;
  const originNotes = [];
  appendFootnotesForPage(originNotes, originItems, origin.getViewport({ scale: 1 }), originPage, null, operators);
  const localNote = originNotes.find(note => note.number === number && !note.continues);
  if (localNote) return localNote;

  let best;
  const notes = [];
  let previous;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (requestId !== lookupRequestId) {
      return null;
    }

    const { items, viewport, rules } = await pageData(pdfDocument, pageNumber, operators);
    appendFootnotesForPage(notes, items, viewport, pageNumber, null, operators, previous, rules);
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

async function jumpToFootnote(rawNumber, originPage = currentPageNumber(), copyMarkdown = false) {
  const number = Number.parseInt(String(rawNumber).trim(), 10);
  if (!Number.isSafeInteger(number) || number <= 0) {
    reportFootnoteError("Enter a footnote number");
    return;
  }

  const requestId = ++lookupRequestId;

  const session = await pdfDocumentSessionReady;
  if (requestId !== lookupRequestId) {
    return;
  }

  if (!session?.document) {
    reportFootnoteError("PDF is not ready");
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
    reportFootnoteError(`Footnote ${number} not found`);
    return;
  }

  scrollToTarget(target, true);
  // Only reference clicks with Markdown enabled should alter the clipboard.
  // The index retains the whole note, including any continuation pages, even
  // when the browser has not rendered all of those PDF text layers.
  if (!copyMarkdown) return;

  const markdown = footnoteToMarkdown(target);
  if (!markdown) {
    window.dispatchEvent(new CustomEvent("pdf-viewer-toast", {
      detail: { message: `Footnote ${number} has no extractable text to copy` },
    }));
    return;
  }

  try {
    await navigator.clipboard.writeText(markdown);
    if (requestId !== lookupRequestId) return;
    window.dispatchEvent(new CustomEvent("pdf-viewer-toast", {
      detail: { message: `Copied footnote ${number} as Markdown` },
    }));
  } catch {
    if (requestId !== lookupRequestId) return;
    window.dispatchEvent(new CustomEvent("pdf-viewer-toast", {
      detail: { message: `Could not copy footnote ${number}` },
    }));
  }
}

window.addEventListener("pdf-viewer-inline-footnote-jump", (event) => {
  const { number, originPage } = event.detail || {};
  if (Number.isSafeInteger(number) && number > 0) {
    const copyMarkdown = document.querySelector("#copy-as-markdown")?.checked === true;
    void jumpToFootnote(number, Number.isSafeInteger(originPage) ? originPage : currentPageNumber(), copyMarkdown);
  }
});


export { scrollToTarget };
