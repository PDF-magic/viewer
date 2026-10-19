// PDF outlines sometimes include spreadsheet sheet names and table cells.
// Filter only conspicuously noisy sibling groups; source bookmarks remain available.
const MEASUREMENT = /^(?:[$€£]?\(?[-+]?\d[\d,.]*\)?%?|\d+\/\d+|[\d,.]+(?:\s*(?:bp|bps))?)$/i;
const GENERATED_NAME = /(?:[_]|^(?:data|chart|tab|sheet|plot|rankdat|week)\d+$|^ods_chart\b)/i;
const BARE_COLUMN = /^(?:variable|mean|median|rank|lowest|highest|quartile\s+\d+|total|volume|price|date|share|add|reduce|buy side|sell side)$/i;
const PRINTED_HEADING = /^(?:(?:\d+(?:\.\d+)*[.)]|[IVXLCDM]+[.)])\s+[A-Za-z]|(?:chapter|section|part|appendix)\s+\w+|(?:table|figure)\s+\d+\b|(?:abstract|introduction|conclusions?|references|bibliography|executive summary)\b)/i;

export function looksLikeBookmarkData(title) {
  const text = String(title || "").trim();
  return !text || !/[A-Za-z]/.test(text) || MEASUREMENT.test(text) || GENERATED_NAME.test(text) || BARE_COLUMN.test(text) || text.length > 180;
}

export function filterOutlineHeadings(items) {
  let hidden = 0;
  function visit(siblings) {
    const entries = Array.isArray(siblings) ? siblings : [];
    const suspect = entries.length >= 12 &&
      entries.filter(item => looksLikeBookmarkData(item?.title)).length >= 6;
    let position = 0;
    return entries.flatMap(item => {
      const title = item?.title?.trim();
      if (!title) return [];
      position += 1;
      const children = visit(item.items);
      const retainsChildren = children.length > 0;
      const firstDocumentTitle = position === 1 &&
        !looksLikeBookmarkData(title) && title.split(/\s+/).length >= 3 && title.length <= 100;
      if (suspect && !retainsChildren && !PRINTED_HEADING.test(title) && !firstDocumentTitle) {
        hidden += 1;
        return [];
      }
      return [{ ...item, title, items: children, pdfMagicSourcePosition: position }];
    });
  }
  return { outline: visit(items), hidden };
}
