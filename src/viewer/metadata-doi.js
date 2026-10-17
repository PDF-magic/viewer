// Extract DOI identifiers from PDF Info and XMP without trusting metadata as a link target.
const DOI_MATCH = /(?:^|[^\w])(10\.\d{4,9}\/[^\s<>"']+)/i;
const DOI_LINK = /\bhttps?:\/\/(?:dx\.)?doi\.org\/[^\s<>"']+/i;

function normalizeDoi(candidate) {
  if (typeof candidate !== "string") return null;
  let doi = candidate.trim().replace(/[.,;:!?]+$/g, "");
  // Drop closing punctuation from prose without damaging balanced DOI suffixes.
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
    while (doi.endsWith(close) && doi.split(close).length > doi.split(open).length) {
      doi = doi.slice(0, -1);
    }
  }
  return /^10\.\d{4,9}\/[^\s<>"']+$/i.test(doi) ? doi : null;
}

function doiInText(value) {
  if (typeof value !== "string") return null;
  const link = value.match(DOI_LINK);
  if (link) {
    try {
      const url = new URL(link[0].replace(/[.,;!?]+$/g, ""));
      const doi = normalizeDoi(decodeURIComponent(url.pathname.slice(1)));
      if (doi) return doi;
    } catch {
      // Malformed resolver URLs may still contain a readable bare DOI.
    }
  }
  return normalizeDoi(value.match(DOI_MATCH)?.[1]);
}

function* stringValues(value, depth = 0) {
  if (typeof value === "string") {
    yield value;
  } else if (value && typeof value === "object" && depth < 4) {
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children.slice(0, 128)) {
      yield* stringValues(child, depth + 1);
    }
  }
}

function xmpValue(metadata, key) {
  try {
    return metadata?.get?.(key);
  } catch {
    return null;
  }
}

function xmpFields(metadata) {
  try {
    return metadata?.getAll?.() || null;
  } catch {
    return null;
  }
}

export function doiFromPdfMetadata(info, metadata) {
  // Prefer fields intended for persistent identifiers over incidental text.
  const preferred = [
    xmpValue(metadata, "prism:doi"),
    xmpValue(metadata, "datacite:doi"),
    xmpValue(metadata, "crossref:doi"),
    xmpValue(metadata, "pdfx:doi"),
    info?.Custom?.DOI,
    info?.Custom?.doi,
    info?.DOI,
    info?.doi,
    xmpValue(metadata, "dc:identifier"),
    xmpValue(metadata, "dc:relation"),
    info?.Custom?.Identifier,
    info?.Identifier,
  ];
  for (const source of [...preferred, xmpFields(metadata), info?.Custom, info]) {
    for (const text of stringValues(source)) {
      const doi = doiInText(text);
      if (doi) return doi;
    }
  }
  return null;
}

export function doiResolverUrl(value) {
  const doi = normalizeDoi(value);
  return doi ? "https://doi.org/" + encodeURIComponent(doi).replace(/%2F/gi, "/") : null;
}
