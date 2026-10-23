// Coordinates are normalized to the unrotated, rendered PDF page. Each
// image contributes three corners: top-left, bottom-left, and top-right.
const clampUnit = (value) => Math.max(0, Math.min(1, value));

export function imageRegionsFromCoordinates(coordinates, pageWidth, pageHeight, {
  minimumSide = 24,
  maximumPageCoverage = 0.8,
} = {}) {
  if (!coordinates?.length || !pageWidth || !pageHeight) return [];
  const regions = [];
  for (let offset = 0; offset + 5 < coordinates.length; offset += 6) {
    const corners = Array.from(coordinates.slice(offset, offset + 6));
    if (!corners.every(Number.isFinite)) continue;
    const [ax, ay, bx, by, cx, cy] = corners;
    const xs = [ax, bx, cx, bx + cx - ax];
    const ys = [ay, by, cy, by + cy - ay];
    const x = clampUnit(Math.min(...xs));
    const y = clampUnit(Math.min(...ys));
    const width = clampUnit(Math.max(...xs)) - x;
    const height = clampUnit(Math.max(...ys)) - y;
    if (width <= 0 || height <= 0) continue;
    if (width * height >= maximumPageCoverage) continue; // scanned page backgrounds
    if (width * pageWidth < minimumSide || height * pageHeight < minimumSide) continue;
    regions.push({ x, y, width, height });
  }
  return regions;
}

export function imageCropPixels(region, canvasWidth, canvasHeight) {
  const x = Math.max(0, Math.floor(region.x * canvasWidth));
  const y = Math.max(0, Math.floor(region.y * canvasHeight));
  return {
    x,
    y,
    width: Math.min(canvasWidth - x, Math.max(1, Math.ceil((region.x + region.width) * canvasWidth) - x)),
    height: Math.min(canvasHeight - y, Math.max(1, Math.ceil((region.y + region.height) * canvasHeight) - y)),
  };
}
