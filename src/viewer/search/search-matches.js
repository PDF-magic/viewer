import { continuesWrappedUrl } from "./search-text-normalization.js";
import { normalizeSearchText, prepareSearchText } from "./search-text.js";

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function paragraphBreaks(items) {
  const breaks = new Set();
  const transitions = [];
  let previous;
  items.forEach((item, index) => {
    if (!item.str?.trim() || !item.transform) return;
    const height = Math.abs(item.height || Math.hypot(item.transform[2], item.transform[3]));
    const y = item.transform[5];
    if (previous && height > 0 && previous.height > 0) {
      const gap = Math.abs(y - previous.y);
      const size = Math.max(height, previous.height);
      if (gap > size * 0.5) transitions.push({ index, gap, size, ratio: gap / size });
    }
    previous = { height, y };
  });
  // Infer normal leading from the tighter line transitions. Font height alone
  // would mistake every line of a double-spaced document for a paragraph.
  const ratios = transitions.map(line => line.ratio).sort((a, b) => a - b);
  const leading = ratios[Math.floor((ratios.length - 1) / 4)] || 1.2;
  for (const line of transitions) {
    if (line.gap > line.size * Math.max(leading * 1.3, leading + 0.4)) breaks.add(line.index);
  }
  return breaks;
}

// Keep source offsets through normalization, including ligatures and collapsed
// whitespace, so counting and painting always refer to the same PDF text.
export function findSearchMatches(items, query) {
  const needle = prepareSearchText(normalizeSearchText(query), normalizeSearchText(query));
  if (!needle) return [];
  const url = /^https?:\/\/\S+$/u.test(normalizeSearchText(query));
  const breaks = paragraphBreaks(items);
  let text = "";
  const locations = [];
  function append(value, location) {
    for (const char of value) {
      if (/[\s\u200B-\u200D\u2060\uFEFF]/u.test(char)) {
        if (url || !text || text.endsWith(" ")) continue;
        text += " ";
        locations.push(location);
      } else {
        text += char;
        for (let i = 0; i < char.length; i += 1) locations.push(location);
      }
    }
  }
  items.forEach((item, itemIndex) => {
    if (breaks.has(itemIndex)) {
      text += "\u0000";
      locations.push(null);
    } else if (itemIndex && !continuesWrappedUrl(items[itemIndex - 1], item)) append(" ", null);
    for (const { segment, index } of segments.segment(item.str)) {
      append(segment.normalize("NFKC").toLocaleLowerCase(), {
        itemIndex, start: index, end: index + segment.length,
      });
    }
  });
  const matches = [];
  for (let offset = text.indexOf(needle); offset !== -1; offset = text.indexOf(needle, offset + needle.length)) {
    const ranges = [];
    for (const location of locations.slice(offset, offset + needle.length)) {
      if (!location) continue;
      const previous = ranges.at(-1);
      if (previous?.itemIndex === location.itemIndex) previous.end = location.end;
      else ranges.push({ ...location });
    }
    matches.push({ offset, ordinal: matches.length, ranges });
  }
  return matches;
}
