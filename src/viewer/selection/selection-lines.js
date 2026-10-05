// Merge text-node fragments on the same baseline before joining neighboring lines.
export function selectionLines(rectangles, padding = 0) {
  const lines = [];
  for (const rect of rectangles.filter(r => r.right > r.left && r.bottom > r.top)
    .sort((a, b) => a.top - b.top || a.left - b.left)) {
    const merged = { ...rect };
    // A late fragment can bridge two bands already seen (italic spans often
    // have a different top edge). Merge every connected band, transitively.
    let changed;
    do {
      changed = false;
      for (let index = lines.length - 1; index >= 0; index--) {
        const candidate = lines[index];
        const height = merged.bottom - merged.top;
        const overlap = Math.min(candidate.bottom, merged.bottom) - Math.max(candidate.top, merged.top);
        const sameLine = overlap > Math.min(candidate.bottom - candidate.top, height) * 0.5;
        const horizontalGap = Math.max(candidate.left - merged.right, merged.left - candidate.right, 0);
        if (!sameLine || horizontalGap > height * 1.5) continue;
        merged.left = Math.min(merged.left, candidate.left);
        merged.right = Math.max(merged.right, candidate.right);
        merged.top = Math.min(merged.top, candidate.top);
        merged.bottom = Math.max(merged.bottom, candidate.bottom);
        lines.splice(index, 1);
        changed = true;
      }
    } while (changed);
    lines.push(merged);
  }
  lines.sort((a, b) => a.top - b.top);
  for (let index = 1; index < lines.length; index++) {
    const previous = lines[index - 1], current = lines[index];
    const gap = current.top - previous.bottom;
    const height = Math.min(previous.bottom - previous.top, current.bottom - current.top);
    if (gap >= 0 && gap <= height * 0.65 &&
        Math.min(previous.right, current.right) > Math.max(previous.left, current.left)) {
      const middle = (previous.bottom + current.top) / 2;
      previous.bottom = current.top = middle;
    }
  }
  return lines.map(line => ({
    ...line,
    left: line.left - padding, right: line.right + padding,
    top: line.top - padding, bottom: line.bottom + padding,
  }));
}
