// XMP is preferred; preserve PDF Info for fallback and discrepancy display.
export function metadataText(value) {
  if (Array.isArray(value)) return value.map(metadataText).filter(Boolean).join(", ");
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function xmpText(metadata, keys) {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    try {
      const value = metadataText(metadata?.get?.(key));
      if (value) return value;
    } catch {
      // Invalid XMP must not prevent reading the Info Dictionary.
    }
  }
  return "";
}

export function metadataField(info, metadata, infoKey, xmpKeys) {
  const infoValue = metadataText(info?.[infoKey]);
  const xmpValue = xmpText(metadata, xmpKeys);
  return {
    value: xmpValue || infoValue,
    source: xmpValue ? "XMP" : infoValue ? "PDF Info" : "",
    xmpValue,
    infoValue,
    conflict: Boolean(xmpValue && infoValue
      && xmpValue.replace(/\s+/g, " ") !== infoValue.replace(/\s+/g, " ")),
  };
}

export function metadataValue(info, metadata, infoKey, xmpKeys) {
  return metadataField(info, metadata, infoKey, xmpKeys).value;
}

export function pdfMetadataTitle(info, metadata) {
  return metadataValue(info, metadata, "Title", "dc:title").replace(/\s+/g, " ").trim();
}
