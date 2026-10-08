const LOCAL_PDF_FAVICON = "assets/sparkle-favicon.svg";

// The viewer is shared by web and file:// PDFs. Keep the normal
// web favicon unless the document's original URL is a local file.
export function updatePdfFaviconForLocalSource(sourceUrl, favicon) {
  if (!favicon || !sourceUrl) {
    return false;
  }

  try {
    if (new URL(sourceUrl).protocol !== "file:") {
      return false;
    }
  } catch {
    return false;
  }

  favicon.setAttribute("type", "image/svg+xml");
  favicon.setAttribute("href", LOCAL_PDF_FAVICON);
  return true;
}
