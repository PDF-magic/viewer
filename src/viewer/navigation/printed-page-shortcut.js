// A trailing asterisk in the ordinary PDF page input explicitly selects
// a document-printed label. Plain values continue to mean physical PDF pages.
export function printedPageShortcutQuery(value) {
  const typed = String(value ?? "").trim();
  return typed.endsWith("*") ? typed.slice(0, -1).trim() : null;
}
