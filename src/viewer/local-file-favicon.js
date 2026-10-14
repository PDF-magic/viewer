// Resolve against this module rather than the address-bar URL. MIME-handled
// PDFs retain their file:// URL even though the viewer lives in the extension.
export function localPdfFaviconUrl(moduleUrl = import.meta.url) {
  return new URL('../assets/sparkle-favicon.svg', moduleUrl).href;
}

// The viewer is shared by web and file:// PDFs. Keep the regular
// web favicon unless the document's original URL is a local file.
export function updatePdfFaviconForLocalSource(sourceUrl, favicon) {
  if (!favicon || !sourceUrl) {
    return false;
  }

  try {
    if (new URL(sourceUrl).protocol !== 'file:') {
      return false;
    }
  } catch {
    return false;
  }

  favicon.setAttribute('type', 'image/svg+xml');
  favicon.setAttribute('href', localPdfFaviconUrl());
  return true;
}
