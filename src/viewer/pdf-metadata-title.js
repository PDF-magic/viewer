// Use the same PDF Info/XMP precedence for browser-tab titles and section metadata.
export function metadataText(value) {
  if (Array.isArray(value)) {
    return value.map(metadataText).filter(Boolean).join(", ");
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

export function metadataValue(info, metadata, infoKey, xmpKey) {
  const infoValue = metadataText(info?.[infoKey]);
  return infoValue || metadataText(metadata?.get?.(xmpKey));
}

export function pdfMetadataTitle(info, metadata) {
  return metadataValue(info, metadata, "Title", "dc:title").replace(/\s+/g, " ").trim();
}
