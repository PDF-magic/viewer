const RESUME_KEY = "pdf-viewer-resume-page";

function documentId(originalUrl) {
  const url = new URL(originalUrl.href);
  url.hash = "";
  return url.href;
}

// Session storage is tab-scoped. Keep the original fragment so following a
// different #page link to the same document does not reuse a prior position.
export function readResumedPage(storage, originalUrl, viewerHash = "") {
  try {
    const saved = JSON.parse(storage.getItem(RESUME_KEY) || "null");
    if (
      saved?.document !== documentId(originalUrl) ||
      saved.sourceHash !== originalUrl.hash ||
      saved.viewerHash !== viewerHash
    ) {
      return null;
    }
    return Number.isSafeInteger(saved.page) && saved.page >= 1 ? saved.page : null;
  } catch {
    // Disabled storage, invalid JSON, or inaccessible document URLs must not
    // stop a PDF from opening normally.
    return null;
  }
}

export function saveResumedPage(storage, originalUrl, viewerHash = "", page) {
  if (!Number.isSafeInteger(page) || page < 1) return;
  try {
    storage.setItem(RESUME_KEY, JSON.stringify({
      document: documentId(originalUrl),
      sourceHash: originalUrl.hash,
      viewerHash,
      page,
    }));
  } catch {
    // Reading must still work when storage is disabled or full.
  }
}
