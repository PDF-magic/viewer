// Dark mode is limited to simple HTML documents; do not overwrite site design.
(() => {
  function isPlainHtmlDocument(doc) {
    if (!doc?.body || !doc.documentElement) return false;
    if (doc.contentType?.toLowerCase() !== "text/html") return false;
    if (!doc.body.textContent?.trim()) return false;
    if (doc.querySelector(
      'link[rel~="stylesheet"], style, script, nav, header, footer, aside, form, ' +
      'iframe, canvas, video, audio, svg, button, input, select, textarea, ' +
      '[role="application"], [contenteditable], #app, #root, [data-reactroot]'
    )) return false;
    if (doc.querySelectorAll('div, section, article').length > 12) return false;
    if (doc.querySelectorAll('[style]').length > 16) return false;
    if (doc.querySelectorAll('[class], [id]').length > 25) return false;
    return true;
  }
  // EDGAR exhibits often use legacy inline CSS and <font> markup even though
  // they are ordinary documents, not application-like websites.
  function isRawEdgarHtmlDocument(doc, href) {
    if (!doc?.body || !doc.documentElement) return false;
    if (doc.contentType?.toLowerCase() !== "text/html") return false;
    if (!doc.body.textContent?.trim()) return false;

    let url;
    try {
      url = new URL(href);
    } catch {
      return false;
    }

    return url.protocol === "https:" &&
      /^(?:www\.)?sec\.gov$/i.test(url.hostname) &&
      /^\/Archives\/edgar\/data\/\d+\/[^/]+\/[^/]+\.html?$/i.test(url.pathname);
  }

  globalThis.pdfMagicIsRawEdgarHtmlDocument = isRawEdgarHtmlDocument;
  globalThis.pdfMagicIsPlainHtmlDocument = isPlainHtmlDocument;
})();
