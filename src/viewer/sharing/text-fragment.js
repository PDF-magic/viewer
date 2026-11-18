// Native Chromium PDF viewing supports text fragments. Decode them in
// PDF-magic too when the PDF URL is redirected to the PDF.js viewer.
const MAX_EXCERPT_LENGTH = 180;

export function textFragmentExcerpt(value) {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_EXCERPT_LENGTH) return normalized;
  const prefix = normalized.slice(0, MAX_EXCERPT_LENGTH);
  return prefix.replace(/\s+\S*$/u, "").trim() || prefix;
}

export function pdfTextFragmentUrl(referenceUrl, selectedText, pageNumber) {
  let url;
  try {
    url = new URL(referenceUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:", "file:"].includes(url.protocol)) return null;
  const excerpt = textFragmentExcerpt(selectedText);
  if (!excerpt) return null;
  // Hyphens delimit prefix/suffix grammar and must be escaped in literal text.
  const encoded = encodeURIComponent(excerpt).replace(/[-!'()*]/g, char =>
    "%" + char.charCodeAt(0).toString(16).toUpperCase());
  const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? "page=" + pageNumber : "";
  url.hash = page + ":~:text=" + encoded;
  return url.href;
}

export function pdfTextFragmentFromUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const delimiter = url.hash.indexOf(":~:");
  if (delimiter === -1) return null;
  const directive = url.hash.slice(delimiter + 3)
    .split("&").find(part => part.startsWith("text="));
  if (!directive) return null;
  let text;
  try {
    text = decodeURIComponent(directive.slice(5)).replace(/\s+/gu, " ").trim();
  } catch {
    return null;
  }
  if (!text) return null;
  const pageMatch = url.hash.slice(0, delimiter).match(/(?:^#|[&#])page=(\d+)/i);
  const page = pageMatch ? Number(pageMatch[1]) : null;
  return { text, pageNumber: Number.isSafeInteger(page) && page > 0 ? page : null };
}
