const SVG_NS = "http://www.w3.org/2000/svg";

// Sweep the rectangles into disjoint strips. Fill them once, and stroke only
// exposed edges; intersecting text lines never get a border through the middle.
export function regionPaths(rectangles) {
  const rects = rectangles.filter(r => r.width > 0 && r.height > 0);
  const xs = [...new Set(rects.flatMap(r => [r.left, r.left + r.width]))].sort((a, b) => a - b);
  const strips = [];
  for (let i = 0; i < xs.length - 1; i += 1) {
    const left = xs[i], right = xs[i + 1];
    const intervals = rects.filter(r => r.left < right && r.left + r.width > left)
      .map(r => [r.top, r.top + r.height]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
      else merged.push([...interval]);
    }
    strips.push({ left, right, intervals: merged });
  }
  let fill = "", outline = "";
  function exposed(x, interval, adjacent) {
    let start = interval[0];
    for (const [top, bottom] of adjacent) {
      if (bottom <= start || top >= interval[1]) continue;
      if (top > start) outline += `M${x} ${start}V${top}`;
      start = Math.max(start, bottom);
    }
    if (start < interval[1]) outline += `M${x} ${start}V${interval[1]}`;
  }
  strips.forEach(({ left, right, intervals }, i) => {
    for (const [top, bottom] of intervals) {
      fill += `M${left} ${top}H${right}V${bottom}H${left}Z`;
      outline += `M${left} ${top}H${right}M${left} ${bottom}H${right}`;
      exposed(left, [top, bottom], strips[i - 1]?.intervals || []);
      exposed(right, [top, bottom], strips[i + 1]?.intervals || []);
    }
  });
  return { fill, outline };
}

export function createHighlightGroup(rectangles, className) {
  const paths = regionPaths(rectangles);
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", className);
  for (const name of ["fill", "outline"]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", `highlight-region-${name}`);
    path.setAttribute("d", paths[name]);
    group.append(path);
  }
  return group;
}

export function createHighlightLayer(className, width, height) {
  const layer = document.createElementNS(SVG_NS, "svg");
  layer.setAttribute("class", className);
  layer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  layer.setAttribute("preserveAspectRatio", "none");
  layer.setAttribute("aria-hidden", "true");
  return layer;
}
