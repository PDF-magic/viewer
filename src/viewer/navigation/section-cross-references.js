// A heading's printed number is more reliable than the position it occupies
// in the PDF outline. Synthetic outline positions are not citation targets.
const HEADING_NUMBER = /^\s*(?:§\s*)?((?:\d+(?:\.\d+)*(?:\([a-z0-9]+\))*|[IVXLCDM]+(?:\.[A-Z0-9]+)*|[A-Z](?:\.[A-Z0-9]+)*))[.)]?(?=\s|$)/i;
const REFERENCE_NUMBER = String.raw`(?:\d+(?:\.\d+)*(?:\([a-z0-9]+\))*|[IVXLCDM]+(?:\.[A-Z0-9]+)*|[A-Z](?:\.[A-Z0-9]+)*)`;
const INITIAL_REFERENCE = new RegExp(String.raw`^(${REFERENCE_NUMBER})(?![a-z0-9]|\.[a-z0-9])`, "i");
const MORE_REFERENCE = new RegExp(String.raw`^\s*(?:,\s*(?:and\s+|or\s+)?|\b(?:and|or)\s+|&\s+)(${REFERENCE_NUMBER})(?![a-z0-9]|\.[a-z0-9])`, "i");
const REFERENCE_PREFIX = /\b(?:sections?|secs?\.?|subsections?|parts?|appendi(?:x|ces))\s+|§{1,2}\s*/gi;

export function normalizeSectionReference(reference) {
  return String(reference || "").replace(/\s+/g, "").toUpperCase();
}

export function outlinedSectionHeadings(outline) {
  const sections = [];
  function visit(items, parentReference = "") {
    for (const item of items || []) {
      const title = item?.title?.trim();
      if (!title) continue;
      const explicit = title.match(HEADING_NUMBER)?.[1] || "";
      const reference = explicit
        ? parentReference && !explicit.includes(".") ? `${parentReference}.${explicit}` : explicit
        : "";
      if (reference && item.dest) {
        sections.push({ title, reference, normalizedReference: normalizeSectionReference(reference), item });
      }
      // An unnumbered parent does not supply a fictitious numeric prefix.
      visit(item.items, reference || parentReference);
    }
  }
  visit(outline);
  return sections;
}

// Explicit cross-references only. Ordinary heading numbers, statute citations
// without a heading-like prefix, and prose containing "above" aren't links.
export function findExplicitSectionReferences(text) {
  const matches = [];
  const content = String(text || "");
  for (const prefix of content.matchAll(REFERENCE_PREFIX)) {
    const start = prefix.index;
    let offset = start + prefix[0].length;
    const initial = content.slice(offset).match(INITIAL_REFERENCE);
    if (!initial) continue;
    let lastEnd = offset + initial[0].length;
    const numbers = [initial[1]];
    offset = lastEnd;
    while (numbers.length < 12) {
      const next = content.slice(offset).match(MORE_REFERENCE);
      if (!next) break;
      numbers.push(next[1]);
      offset += next[0].length;
      lastEnd = offset;
    }
    for (const reference of numbers) {
      matches.push({ reference, normalizedReference: normalizeSectionReference(reference), start, end: lastEnd });
    }
  }
  return matches;
}

// Each source is a visual text line with coordinates. Keep columns separate and
// join PDF font fragments that share a baseline, allowing clickable highlights.
export function scanSectionReferencesForPage(items, viewport, pageNumber) {
  const positioned = (items || []).flatMap((item) => {
    if (!item?.str?.trim() || !item.transform || item.transform.length < 6) return [];
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [{ text: item.str.trim(), x, y, width: Math.abs(item.width || 0),
      height: Math.abs(item.height || item.transform[3] || 10), hasEOL: item.hasEOL }];
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const entry of positioned) {
    const line = lines.find((candidate) =>
      Math.abs(candidate.y - entry.y) <= Math.max(2, Math.min(candidate.height, entry.height) * 0.45) &&
      entry.x >= candidate.right - 3 && entry.x - candidate.right <= 42 && !candidate.endsLine);
    if (line) {
      const gap = entry.x - line.right;
      const last = line.parts.at(-1);
      const explicitSpace = /\s$/.test(last.text) || /^\s/.test(entry.text);
      const separator = gap > Math.max(1.2, entry.height * 0.12) || explicitSpace ? " " : "";
      line.text += separator + entry.text;
      line.right = Math.max(line.right, entry.x + entry.width);
      line.bottom = Math.max(line.bottom, entry.y + entry.height * 0.25);
      line.parts.push(entry);
      line.endsLine = Boolean(entry.hasEOL);
    } else {
      lines.push({ text: entry.text, x: entry.x, y: entry.y, right: entry.x + entry.width,
        bottom: entry.y + entry.height * 0.25, height: entry.height, parts: [entry],
        endsLine: Boolean(entry.hasEOL) });
    }
  }

  const results = [];
  for (const line of lines) {
    const citations = findExplicitSectionReferences(line.text);
    for (const citation of citations) {
      // The entry's entire text line is highlighted, preserving a meaningful
      // visual location even when the citation spans several PDF text items.
      results.push({ ...citation, text: line.text, pageNumber,
        yRatio: Math.min(1, Math.max(0, line.y / Math.max(1, viewport.height))),
        highlightRegions: [{ pageNumber,
          left: Math.max(0, line.x / Math.max(1, viewport.width)),
          top: Math.max(0, (line.y - line.height) / Math.max(1, viewport.height)),
          width: Math.max(1, line.right - line.x) / Math.max(1, viewport.width),
          height: Math.max(2, line.bottom - line.y + line.height) / Math.max(1, viewport.height),
        }],
      });
    }
  }
  return results;
}

export function groupSectionReferences(sections, occurrences) {
  const byReference = new Map();
  for (const heading of sections) {
    if (!byReference.has(heading.normalizedReference)) byReference.set(heading.normalizedReference, []);
    byReference.get(heading.normalizedReference).push(heading);
  }
  const groups = sections.map((heading) => ({ heading, references: [] }));
  const groupByHeading = new Map(groups.map((group) => [group.heading, group]));
  const unresolved = [];
  for (const occurrence of occurrences) {
    const targets = byReference.get(occurrence.normalizedReference) || [];
    if (targets.length === 1) groupByHeading.get(targets[0]).references.push(occurrence);
    else unresolved.push({ ...occurrence, reason: targets.length ? "ambiguous heading" : "heading not found" });
  }
  return { groups: groups.filter((group) => group.references.length), unresolved };
}
