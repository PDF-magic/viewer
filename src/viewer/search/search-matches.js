import { continuesWrappedUrl } from "./search-text-normalization.js";
import { normalizeSearchText, prepareSearchText } from "./search-text.js";

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Keep source offsets through normalization, including ligatures and collapsed
// whitespace, so counting and painting always refer to the same PDF text.
export function findSearchMatches(items, query) {
  const needle = prepareSearchText(normalizeSearchText(query), normalizeSearchText(query));
  if (!needle) return [];
  const url = /^https?:\/\/\S+$/u.test(normalizeSearchText(query));
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
    if (itemIndex && !continuesWrappedUrl(items[itemIndex - 1], item)) append(" ", null);
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
