// Merge text-node fragments on the same baseline before joining neighboring lines.
export function selectionLines(rectangles) {
  const lines = [];
  for (const rect of rectangles.filter(r => r.right > r.left && r.bottom > r.top)
    .sort((a, b) => a.top - b.top || a.left - b.left)) {
    const height = rect.bottom - rect.top;
    const line = lines.find(candidate => {
      const overlap = Math.min(candidate.bottom, rect.bottom) - Math.max(candidate.top, rect.top);
      const sameLine = overlap > Math.min(candidate.bottom - candidate.top, height) * 0.5;
      const horizontalGap = Math.max(candidate.left - rect.right, rect.left - candidate.right, 0);
      return sameLine && horizontalGap <= height * 1.5;
    });
    if (line) {
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else lines.push({ ...rect });
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
  return lines;
}
