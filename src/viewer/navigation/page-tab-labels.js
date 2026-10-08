const COUNTER_PATTERN = /^[-–—]?\s*(?:(Page)\s+)?(\d{1,5}|[ivxlcdm]{1,12})(?:\s+of\s+(\d{1,5}))?\s*[-–—]?$/i;
const ROMAN_PATTERN = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;

function romanValue(label) {
  if (!ROMAN_PATTERN.test(label)) return null;
  const values = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const chars = label.toLowerCase().split("");
  return chars.reduce((total, char, index) =>
    total + (values[char] < (values[chars[index + 1]] || 0) ? -values[char] : values[char]), 0);
}

export function parsePrintedPageCounter(text) {
  const match = COUNTER_PATTERN.exec(text.trim().replace(/\s+/g, " "));
  if (!match) return null;
  const label = match[2];
  const roman = !/^\d+$/.test(label);
  const number = roman ? romanValue(label) : Number(label);
  if (!number || number > 99999) return null;
  const total = match[3] ? Number(match[3]) : null;
  if (total !== null && (roman || number > total)) return null;
  return {
    label, number, kind: roman ? "roman" : "arabic",
    explicit: Boolean(match[1] || match[3]),
  };
}

export function findPrintedPageCounter(items, viewport) {
  if (!items?.length || !viewport?.width || !viewport?.height) return null;
  const nearMargin = [];
  for (const item of items) {
    if (typeof item.str !== "string" || !item.transform) continue;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const zone = y < viewport.height * 0.095 ? "header" :
      y > viewport.height * 0.88 ? "footer" : null;
    if (!zone || x < viewport.width * 0.035 || x > viewport.width * 0.97) continue;
    nearMargin.push({ str: item.str, x, y, zone });
  }
  const lines = [];
  for (const item of nearMargin) {
    const line = lines.find((existing) =>
      existing.zone === item.zone && Math.abs(existing.y - item.y) <= viewport.height * 0.01);
    if (line) line.items.push(item);
    else lines.push({ zone: item.zone, y: item.y, items: [item] });
  }
  const candidates = [];
  for (const line of lines) {
    const ordered = line.items.sort((a, b) => a.x - b.x);
    const joined = ordered.map((item) => item.str.trim()).join(" ");
    for (const value of [joined, ...ordered.map((item) => item.str)]) {
      const parsed = parsePrintedPageCounter(value);
      if (parsed) candidates.push({ ...parsed, zone: line.zone });
    }
  }
  return candidates.sort((a, b) => Number(b.explicit) - Number(a.explicit))[0] || null;
}

export function mergedPageTabLabels(pageCount, embeddedLabels, printedCounters = []) {
  const labels = Array.from({ length: pageCount }, (_, index) => String(index + 1));
  if (Array.isArray(embeddedLabels) && embeddedLabels.length === pageCount &&
    embeddedLabels.every((label) => typeof label === "string" && label.trim())) {
    return embeddedLabels.map((label) => label.trim());
  }
  for (let i = 0; i < pageCount; i += 1) {
    const candidate = printedCounters[i];
    if (candidate?.explicit) labels[i] = candidate.label;
    const following = printedCounters[i + 1];
    if (candidate && following &&
      candidate.kind === following.kind &&
      candidate.zone === following.zone &&
      candidate.number + 1 === following.number) {
      labels[i] = candidate.label;
      labels[i + 1] = following.label;
    }
  }
  return labels;
}
