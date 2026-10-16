// Snap only terminal punctuation (plus any closing quotes or brackets), not
// ordinary sentence punctuation followed by more text in the same span.
const ENDING_PUNCTUATION = /([.!?…。！？]+["'”’»\)\]\}]*)\s*$/u;

export function trailingPunctuationOffsets(text) {
  const match = ENDING_PUNCTUATION.exec(text);
  if (!match) return null;
  const start = text.length - match[0].length;
  return { start, end: start + match[1].length };
}

// A narrow left-side tolerance makes the final glyph easy to capture; moving
// directly before it keeps the punctuation out of the native selection.
export function shouldIncludeTrailingPunctuation({ x, y, rect, focusOffset, offsets, forward }) {
  if (!forward || !offsets || !rect || rect.width <= 0 || rect.height <= 0 ||
      focusOffset < offsets.start || focusOffset >= offsets.end) return false;
  const lead = Math.min(2, rect.width * 0.2);
  const vertical = Math.min(3, rect.height * 0.15);
  return x >= rect.left - lead && x <= rect.right + 2 &&
    y >= rect.top - vertical && y <= rect.bottom + vertical;
}
