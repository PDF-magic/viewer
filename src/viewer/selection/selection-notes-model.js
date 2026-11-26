const STORAGE_PREFIX = "pdf-viewer-selection-notes:v1:";

export function notesStorageKey(fingerprint, source) {
  return STORAGE_PREFIX + (fingerprint || source || "unknown-document");
}

export function normalizeNoteQuote(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

// PDF.js recreates text spans during zooming and page virtualization. Prefer
// the original offsets, then recover the closest occurrence of the same text.
export function resolveNoteOffsets(text, note) {
  if (typeof text !== "string" || !note || typeof note.raw !== "string" || !note.raw) {
    return null;
  }
  if (Number.isInteger(note.start) && Number.isInteger(note.end) &&
      note.start >= 0 && note.end <= text.length && note.end > note.start &&
      text.slice(note.start, note.end) === note.raw) {
    return { start: note.start, end: note.end };
  }
  let candidate = text.indexOf(note.raw);
  let nearest = -1;
  while (candidate !== -1) {
    if (nearest === -1 || Math.abs(candidate - note.start) < Math.abs(nearest - note.start)) {
      nearest = candidate;
    }
    candidate = text.indexOf(note.raw, candidate + 1);
  }
  return nearest === -1 ? null : { start: nearest, end: nearest + note.raw.length };
}

export function formatSelectionNotes(notes, title, source) {
  const heading = String(title || "PDF notes").trim() || "PDF notes";
  const lines = [heading];
  if (source) lines.push("Source: " + source);
  const ordered = [...notes].sort((a, b) => a.page - b.page || a.start - b.start);
  for (const [index, item] of ordered.entries()) {
    lines.push("", "Note " + (index + 1) + " — page " + item.page,
      "Quote: " + normalizeNoteQuote(item.quote || item.raw),
      "Note: " + item.text.trim());
  }
  return lines.join("\n") + "\n";
}

export function selectionNotesFilename(title) {
  const stem = String(title || "document")
    .replace(/\.pdf$/i, "")
    .replace(/[\\/<>:"|?*\x00-\x1f]/g, "_")
    .trim().slice(0, 120) || "document";
  return stem + "-notes.txt";
}
