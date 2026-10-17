import { selectionLines } from "./selection-lines.js";

function overlapsRow(rect, row) {
  return Math.min(rect.bottom, row.bottom) - Math.max(rect.top, row.top) >
    Math.min(rect.bottom - rect.top, row.bottom - row.top) * 0.5;
}

function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
}

// PDF text streams (especially OCR) can place a word or a final line after
// the following paragraph in DOM order. A native drag range then skips those
// fragments even though they fall inside the visually selected passage.
// Fill only text-backed gaps bracketed by selected ink on both sides or on
// adjacent lines; never extend a selection beyond its first/last visual line.
export function recoverSelectionGaps(selectedRects, otherTextRects) {
  if (selectedRects.length < 2 || !otherTextRects.length) return selectedRects;
  const rows = selectionLines(selectedRects);
  if (rows.length < 2) return selectedRects;
  const recovered = [];
  for (const rect of otherTextRects) {
    if (!(rect.right > rect.left && rect.bottom > rect.top)) continue;
    const inline = rows.some(left => overlapsRow(rect, left) && left.right <= rect.left + 2 &&
      rows.some(right => right !== left && overlapsRow(rect, right) &&
        right.left >= rect.right - 2 && right.left - left.right <= rect.right - rect.left + 4));
    if (inline) {
      recovered.push(rect);
      continue;
    }
    // Entirely skipped printed lines are bounded by selected lines above and
    // below in the same column. Limit the distance to avoid capturing an
    // unrelated heading, column, or note between remote selections.
    let above = null, below = null;
    for (const row of rows) {
      if (row.bottom <= rect.top + 2 && (!above || row.bottom > above.bottom)) above = row;
      if (row.top >= rect.bottom - 2 && (!below || row.top < below.top)) below = row;
    }
    if (!above || !below) continue;
    const height = Math.min(above.bottom - above.top, below.bottom - below.top);
    if (rect.top - above.bottom > height * 1.5 || below.top - rect.bottom > height * 1.5) continue;
    const width = rect.right - rect.left;
    if (horizontalOverlap(rect, above) >= width * 0.5 &&
        horizontalOverlap(rect, below) >= width * 0.5) recovered.push(rect);
  }
  return recovered.length ? [...selectedRects, ...recovered] : selectedRects;
}
