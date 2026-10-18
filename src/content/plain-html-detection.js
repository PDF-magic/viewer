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
  globalThis.pdfMagicIsPlainHtmlDocument = isPlainHtmlDocument;
})();
