import { continuesWrappedUrl } from "./search-text-normalization.js";
import { normalizeSearchText, prepareSearchText } from "./search-text.js";

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function continuesHyphenatedWord(previous, current) {
  return Boolean(previous?.hasEOL &&
    /[\p{L}][-\u00AD\u2010]$/u.test(previous.str) &&
    /^\p{L}/u.test(current?.str ?? "") &&
    !continuesWrappedUrl(previous, current));
}

// Keep source offsets through normalization, including ligatures and collapsed
// whitespace, so counting and painting always refer to the same PDF text.
export function findSearchMatches(items, query) {
  const needle = prepareSearchText(normalizeSearchText(query), normalizeSearchText(query));
  if (!needle) return [];
  const url = /^https?:\/\/\S+$/u.test(normalizeSearchText(query));
  const preserveHyphens = /[-\u00AD\u2010]/u.test(needle);
  let text = "";
  const locations = [];
  const removedHyphens = [];
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
    const previous = items[itemIndex - 1];
    const wrappedWord = !url && itemIndex > 0 && continuesHyphenatedWord(previous, item);
    if (wrappedWord && !preserveHyphens && /[-\u00AD\u2010]$/u.test(text)) {
      const location = locations.pop();
      text = text.slice(0, -1);
      removedHyphens.push({ offset: text.length, location });
    } else if (itemIndex && !wrappedWord && !continuesWrappedUrl(previous, item)) {
      append(" ", null);
    }
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
    // A search spanning a soft line-break should also highlight the printed
    // hyphen, without changing the PDF's selectable or copied text.
    for (const hyphen of removedHyphens) {
      if (offset >= hyphen.offset || offset + needle.length <= hyphen.offset) continue;
      const sourceRange = ranges.find(range => range.itemIndex === hyphen.location.itemIndex);
      if (sourceRange) sourceRange.end = Math.max(sourceRange.end, hyphen.location.end);
    }
    matches.push({ offset, ordinal: matches.length, ranges });
  }
  return matches;
}
