import { pdfDocumentSessionReady } from "../pdf-document-session.js";
import { confirmedPrintedPageLabels, findPrintedPageCounter } from "./page-tab-labels.js";

function normalizeLabel(value) {
  const key = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
  // Treat a typed 7 as equivalent to an embedded 007, but do not conflate Roman VII.
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key;
}

export function matchingDocumentPageLabels(query, confirmedLabels) {
  const key = normalizeLabel(query);
  if (!key || !Array.isArray(confirmedLabels)) return [];
  return confirmedLabels.flatMap((label, index) =>
    typeof label === "string" && normalizeLabel(label) === key ? [index + 1] : []);
}

// Shared by the optional side page tabs and the always-available printed-page jump.
// A document is scanned only on explicit navigation or while the tab rail is shown.
export function createPageLabelIndex(pdf) {
  const count = pdf.numPages;
  const counters = new Array(count).fill(null);
  let confirmed = new Array(count).fill(null);
  let display = confirmed.map((_, index) => String(index + 1));
  let hasEmbeddedLabels = false;
  let nextToScan = 0;
  let metadataPromise;
  let scanPromise;
  const listeners = new Set();

  function publish() {
    confirmed = confirmedPrintedPageLabels(count, hasEmbeddedLabels ? confirmed : null, counters);
    display = confirmed.map((label, index) => label ?? String(index + 1));
    for (const callback of listeners) callback(display);
  }

  function loadMetadata() {
    if (!metadataPromise) {
      metadataPromise = (async () => {
        let labels = null;
        try {
          labels = await pdf.getPageLabels();
        } catch {
          // Some PDFs have no label metadata. Printed margin text is a fallback.
        }
        if (Array.isArray(labels) && labels.length === count &&
          labels.every((label) => typeof label === "string" && label.trim())) {
          hasEmbeddedLabels = true;
          confirmed = labels.map((label) => label.trim());
          publish();
        }
      })();
    }
    return metadataPromise;
  }

  async function scan(shouldContinue = () => true) {
    await loadMetadata();
    if (hasEmbeddedLabels) return confirmed;
    // If the tab rail is scanning when a search begins, join it and then
    // resume any remaining pages without doing duplicate getTextContent calls.
    while (nextToScan < count && shouldContinue()) {
      if (scanPromise) {
        await scanPromise;
        continue;
      }
      const pending = (async () => {
        while (nextToScan < count && shouldContinue()) {
          const index = nextToScan++;
          try {
            const page = await pdf.getPage(index + 1);
            const [content, viewport] = await Promise.all([
              page.getTextContent(),
              Promise.resolve(page.getViewport({ scale: 1 })),
            ]);
            counters[index] = findPrintedPageCounter(content.items, viewport);
          } catch {
            // Scanned or unreadable pages keep null, not a guessed page label.
          }
          if (nextToScan % 8 === 0 || nextToScan === count) {
            publish();
            // Yield to scrolling, text selection and the progress indicator.
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        publish();
      })();
      scanPromise = pending;
      try {
        await pending;
      } finally {
        if (scanPromise === pending) scanPromise = null;
      }
    }
    return confirmed;
  }

  return {
    loadMetadata,
    scan,
    getLabels: () => display,
    getConfirmedLabels: () => confirmed,
    subscribe(callback) {
      listeners.add(callback);
      callback(display);
      return () => listeners.delete(callback);
    },
  };
}

export const pageLabelIndexReady = pdfDocumentSessionReady.then((session) =>
  session?.document ? createPageLabelIndex(session.document) : null);
