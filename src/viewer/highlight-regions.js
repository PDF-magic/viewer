const SVG_NS = "http://www.w3.org/2000/svg";

// Sweep the rectangles into disjoint strips. Fill them once, and stroke only
// exposed edges; intersecting text lines never get a border through the middle.
export function regionPaths(rectangles, radius = 0) {
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
  const edges = [];
  function vertical(x, top, bottom, leftEdge) {
    outline += `M${x} ${top}V${bottom}`;
    edges.push(leftEdge ? [[x, bottom], [x, top]] : [[x, top], [x, bottom]]);
  }
  function exposed(x, interval, adjacent, leftEdge) {
    let start = interval[0];
    for (const [top, bottom] of adjacent) {
      if (bottom <= start || top >= interval[1]) continue;
      if (top > start) vertical(x, start, top, leftEdge);
      start = Math.max(start, bottom);
    }
    if (start < interval[1]) vertical(x, start, interval[1], leftEdge);
  }
  strips.forEach(({ left, right, intervals }, i) => {
    for (const [top, bottom] of intervals) {
      fill += `M${left} ${top}H${right}V${bottom}H${left}Z`;
      outline += `M${left} ${top}H${right}M${left} ${bottom}H${right}`;
      edges.push([[left, top], [right, top]], [[right, bottom], [left, bottom]]);
      exposed(left, [top, bottom], strips[i - 1]?.intervals || [], true);
      exposed(right, [top, bottom], strips[i + 1]?.intervals || [], false);
    }
  });
  if (radius > 0) {
    const rounded = roundedBoundary(edges, radius);
    return { fill: rounded, outline: rounded };
  }
  return { fill, outline };
}

function roundedBoundary(edges, radius) {
  const key = point => point.join(",");
  const outgoing = new Map();
  for (const edge of edges) {
    const start = key(edge[0]);
    if (!outgoing.has(start)) outgoing.set(start, []);
    outgoing.get(start).push(edge);
  }
  const used = new Set();
  let path = "";
  for (const first of edges) {
    if (used.has(first)) continue;
    const points = [];
    let edge = first;
    while (edge && !used.has(edge)) {
      used.add(edge);
      points.push(edge[0]);
      edge = outgoing.get(key(edge[1]))?.find(next => !used.has(next));
    }
    const corners = points.filter((point, index) => {
      const previous = points[(index + points.length - 1) % points.length];
      const next = points[(index + 1) % points.length];
      return (point[0] - previous[0]) * (next[1] - point[1]) !==
        (point[1] - previous[1]) * (next[0] - point[0]);
    });
    corners.forEach((point, index) => {
      const previous = corners[(index + corners.length - 1) % corners.length];
      const next = corners[(index + 1) % corners.length];
      const before = Math.hypot(previous[0] - point[0], previous[1] - point[1]);
      const after = Math.hypot(next[0] - point[0], next[1] - point[1]);
      const r = Math.min(radius, before / 2, after / 2);
      const entry = point.map((value, axis) => value + (previous[axis] - value) * r / before);
      const exit = point.map((value, axis) => value + (next[axis] - value) * r / after);
      path += `${index ? "L" : "M"}${entry.join(" ")}Q${point.join(" ")} ${exit.join(" ")}`;
    });
    path += "Z";
  }
  return path;
}

export function createHighlightGroup(rectangles, className, radius = 0) {
  const paths = regionPaths(rectangles, radius);
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
