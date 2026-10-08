// Recognize explicit cross-footnote citations, rather than every use of supra or infra.
// Both "supra note 12" and "note 12, supra" are common in legal writing.
const NOTE_NUMBERS = String.raw`\d+(?:\s*(?:[-–—]|,\s*(?:and\s+)?|\band\b\s+|&)\s*\d+)*`;
const NOTE_LABEL = String.raw`(?:footnotes?|notes?|nn?\.)`;
const CROSS_REFERENCE = new RegExp(
  String.raw`\b(supra|infra)\b\s*[,;:]?\s*(?:at\s+)?${NOTE_LABEL}\s*#?\s*(${NOTE_NUMBERS})` +
  String.raw`|\b${NOTE_LABEL}\s*#?\s*(${NOTE_NUMBERS})\s*,?\s*\b(supra|infra)\b`,
  "gi",
);

function referencedNumbers(text) {
  const numbers = [];
  const segments = text.replace(/\s+(?:and|&)\s+/gi, ",").split(/\s*,\s*/);
  for (const segment of segments) {
    const range = segment.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      // Avoid exploding on large or malformed ranges in extracted PDF text.
      if (start > 0 && end >= start && end - start <= 30) {
        for (let number = start; number <= end; number += 1) numbers.push(number);
      }
    } else if (/^\d+$/.test(segment)) {
      numbers.push(Number(segment));
    }
  }
  return numbers.filter((number) => Number.isSafeInteger(number) && number > 0);
}

export function findFootnoteCrossReferences(text) {
  const references = [];
  const seen = new Set();
  for (const match of String(text || "").matchAll(CROSS_REFERENCE)) {
    const direction = (match[1] || match[4]).toLowerCase();
    for (const number of referencedNumbers(match[2] || match[3])) {
      const key = `${direction}:${number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push({ direction, number });
    }
  }
  return references;
}

// Repeated note numbers can occur in separate chapters. Prefer the closest
// matching note in the direction specified by the citation.
export function crossReferencedFootnotes(notes) {
  return notes.flatMap((source, sourceIndex) => {
    const references = findFootnoteCrossReferences(source.text).map((reference) => {
      let target = null;
      for (let index = 0; index < notes.length; index += 1) {
        if (notes[index].number !== reference.number || index === sourceIndex) continue;
        if (reference.direction === "supra" ? index >= sourceIndex : index <= sourceIndex) continue;
        if (!target || Math.abs(index - sourceIndex) < Math.abs(target.index - sourceIndex)) {
          target = { index, note: notes[index] };
        }
      }
      return { ...reference, target: target?.note || null };
    });
    return references.length ? [{ source, references }] : [];
  });
}
