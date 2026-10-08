// A PDF can print a table of contents without embedding link annotations.
// Only recognize entries on pages explicitly headed "Contents" to avoid
// turning incidental page references elsewhere into navigation links.

export function normalizedContentsTitle(title = "") {
  return title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
}

function joinLineParts(parts) {
  let text = "";
  let right = -Infinity;
  for (const part of parts) {
    if (text && part.left - right > Math.max(3, part.height * 0.2)) text += "  ";
    text += part.text;
    right = Math.max(right, part.right);
  }
  return text.replace(/\s+/g, " ").trim();
}

export function findPrintedContentsEntries(items, viewport) {
  if (typeof viewport?.convertToViewportPoint !== "function") return [];
  const lines = [];
  for (const item of items) {
    if (!item.str?.trim() || !Array.isArray(item.transform) || item.transform.length < 6) continue;
    // Plain, horizontal text only. PDF text coordinates are in page user units.
    if (Math.abs(item.transform[1]) > 0.01 || Math.abs(item.transform[2]) > 0.01) continue;
    const [left, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const height = Math.max(9, Math.abs(item.height || item.transform[3] || 0) * viewport.scale);
    const right = left + Math.max(0, item.width || 0) * viewport.scale;
    if (![left, baseline, right, height].every(Number.isFinite)) continue;
    let line = lines.find(line => Math.abs(line.baseline - baseline) <= Math.max(3, height * 0.3));
    if (!line) {
      line = { baseline, parts: [] };
      lines.push(line);
    }
    line.parts.push({ text: item.str, left, right, height });
  }
  lines.sort((a, b) => a.baseline - b.baseline);
  const rows = lines.map(line => {
    line.parts.sort((a, b) => a.left - b.left);
    return {
      text: joinLineParts(line.parts),
      baseline: line.baseline,
      left: Math.min(...line.parts.map(part => part.left)),
      right: Math.max(...line.parts.map(part => part.right)),
      height: Math.max(...line.parts.map(part => part.height)),
    };
  });
  const heading = rows.findIndex((row, i) =>
    i < 25 && row.baseline < viewport.height * 0.42 &&
    /^(?:(?:table|list) of )?contents(?:\s*\(?continued\)?)?\s*$/i.test(row.text),
  );
  if (heading < 0) return [];

  const entries = [];
  for (const row of rows.slice(heading + 1)) {
    if (row.baseline > viewport.height * 0.93) continue; // Running footers.
    // Require a page number at the end. Dotted leaders are optional because
    // many PDFs put the page number in a separate text fragment.
    const match = row.text.match(/^(.{4,}?)(?:\s*[.·…]{2,}\s*|\s+)(\d{1,4}|[ivxlcdm]{1,8})\s*$/i);
    if (!match) continue;
    const title = match[1].replace(/[.·…\s]+$/, "").trim();
    if (!/[\p{L}]/u.test(title)) continue;
    entries.push({
      title,
      label: match[2],
      left: Math.max(0, row.left - 3),
      top: Math.max(0, row.baseline - row.height * 1.3),
      width: Math.min(viewport.width - row.left + 3, row.right - row.left + 8),
      height: row.height * 1.7,
    });
  }
  // A heading and one random number are not sufficient evidence of a TOC.
  return entries.length >= 2 ? entries : [];
}

export async function resolvePrintedContentsPage(entry, { numPages, pageLabels, outline, resolveOutlinePage }) {
  const key = normalizedContentsTitle(entry.title);
  const matches = outline.filter(item => normalizedContentsTitle(item.title) === key);
  if (matches.length === 1) {
    try {
      const page = await resolveOutlinePage(matches[0]);
      if (Number.isInteger(page) && page >= 1 && page <= numPages) return page;
    } catch { /* Try printed page labels instead. */ }
  }
  if (Array.isArray(pageLabels)) {
    const index = pageLabels.findIndex(label => label?.toLowerCase() === entry.label.toLowerCase());
    if (index >= 0) return index + 1;
  }
  const physicalPage = Number(entry.label);
  return Number.isInteger(physicalPage) && physicalPage >= 1 && physicalPage <= numPages
    ? physicalPage : null;
}

export function contentsEntryHasEmbeddedLink(entry, annotations, viewport) {
  return annotations.some(annotation => {
    if (annotation.subtype !== "Link" || !Array.isArray(annotation.rect)) return false;
    // PDF.js 6 exposes point conversion rather than rectangle conversion.
    const rect = [
      ...viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]),
      ...viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]),
    ];
    const left = Math.min(rect[0], rect[2]);
    const right = Math.max(rect[0], rect[2]);
    const top = Math.min(rect[1], rect[3]);
    const bottom = Math.max(rect[1], rect[3]);
    return left < entry.left + entry.width && right > entry.left &&
      top < entry.top + entry.height && bottom > entry.top;
  });
}
