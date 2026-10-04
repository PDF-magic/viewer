const SESSION_KEY = "__pdfViewerDocumentSession";

if (!globalThis[SESSION_KEY]) {
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  globalThis[SESSION_KEY] = {
    ready,
    resolveReady,
    settled: false,
  };
}

const sessionState = globalThis[SESSION_KEY];

export const pdfDocumentSessionReady = sessionState.ready;

export function publishPdfDocument(pdfDocument, operators) {
  if (sessionState.settled) {
    return;
  }

  sessionState.settled = true;
  sessionState.resolveReady({
    document: pdfDocument,
    operators,
    fingerprint: pdfDocument.fingerprints?.[0] || null,
  });
}

export function abandonPdfDocumentSession() {
  if (sessionState.settled) {
    return;
  }

  sessionState.settled = true;
  sessionState.resolveReady(null);
}
