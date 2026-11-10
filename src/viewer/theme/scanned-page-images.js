// PDF.js imageCoordinates contain normalized top-left, bottom-left, and top-right
// coordinates for each embedded image. Scanned pages may be built from tiles.
function imageAreaFraction(imageCoordinates, offset) {
  const topLeftX = imageCoordinates[offset];
  const topLeftY = imageCoordinates[offset + 1];
  const bottomLeftX = imageCoordinates[offset + 2];
  const bottomLeftY = imageCoordinates[offset + 3];
  const topRightX = imageCoordinates[offset + 4];
  const topRightY = imageCoordinates[offset + 5];
  const leftX = bottomLeftX - topLeftX;
  const leftY = bottomLeftY - topLeftY;
  const topX = topRightX - topLeftX;
  const topY = topRightY - topLeftY;

  return Math.abs(leftX * topY - leftY * topX);
}

export function hasPageSizedImage(imageCoordinates) {
  const SCANNED_PAGE_IMAGE_AREA_THRESHOLD = 0.8;
  const PAGE_COVERAGE_SAMPLE_GRID = 20;
  const cells = new Uint8Array(PAGE_COVERAGE_SAMPLE_GRID ** 2);
  let coveredCount = 0;

  for (let offset = 0; offset + 5 < (imageCoordinates?.length || 0); offset += 6) {
    const area = imageAreaFraction(imageCoordinates, offset);
    if (area >= SCANNED_PAGE_IMAGE_AREA_THRESHOLD) return true;
    if (area <= 0) continue;

    const x = imageCoordinates[offset];
    const y = imageCoordinates[offset + 1];
    const vx = imageCoordinates[offset + 2] - x;
    const vy = imageCoordinates[offset + 3] - y;
    const ux = imageCoordinates[offset + 4] - x;
    const uy = imageCoordinates[offset + 5] - y;
    const determinant = ux * vy - uy * vx;
    if (Math.abs(determinant) < Number.EPSILON) continue;

    const minX = Math.max(0, Math.floor(Math.min(x, x + ux, x + vx, x + ux + vx) * PAGE_COVERAGE_SAMPLE_GRID));
    const maxX = Math.min(PAGE_COVERAGE_SAMPLE_GRID, Math.ceil(Math.max(x, x + ux, x + vx, x + ux + vx) * PAGE_COVERAGE_SAMPLE_GRID));
    const minY = Math.max(0, Math.floor(Math.min(y, y + uy, y + vy, y + uy + vy) * PAGE_COVERAGE_SAMPLE_GRID));
    const maxY = Math.min(PAGE_COVERAGE_SAMPLE_GRID, Math.ceil(Math.max(y, y + uy, y + vy, y + uy + vy) * PAGE_COVERAGE_SAMPLE_GRID));

    for (let row = minY; row < maxY; row += 1) {
      for (let col = minX; col < maxX; col += 1) {
        const index = row * PAGE_COVERAGE_SAMPLE_GRID + col;
        if (cells[index]) continue;
        const dx = (col + 0.5) / PAGE_COVERAGE_SAMPLE_GRID - x;
        const dy = (row + 0.5) / PAGE_COVERAGE_SAMPLE_GRID - y;
        const u = (dx * vy - dy * vx) / determinant;
        const v = (ux * dy - uy * dx) / determinant;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
          cells[index] = 1;
          coveredCount += 1;
          if (coveredCount / cells.length >= SCANNED_PAGE_IMAGE_AREA_THRESHOLD) return true;
        }
      }
    }
  }

  return false;
}
