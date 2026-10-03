const URL_TOKEN_PATTERN = /(?:^|\s)((?:https?:\/\/|www\.)\S*)$/i;
const URL_CONTINUATION_PATTERN = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]/;

function isTextItem(item) {
  return Boolean(item && typeof item === "object" && "str" in item && typeof item.str === "string");
}

function continuesWrappedUrl(previous, current) {
  if (!previous.hasEOL || !previous.str || !current.str) {
    return false;
  }

  if (/\s$/.test(previous.str) || /^\s/.test(current.str)) {
    return false;
  }

  return URL_TOKEN_PATTERN.test(previous.str) && URL_CONTINUATION_PATTERN.test(current.str);
}

export function mergeWrappedUrlTextItems(items) {
  const merged = [];

  for (const item of items) {
    const previous = merged.at(-1);

    if (isTextItem(previous) && isTextItem(item) && continuesWrappedUrl(previous, item)) {
      merged[merged.length - 1] = {
        ...previous,
        str: `${previous.str}${item.str}`,
        hasEOL: item.hasEOL,
      };
      continue;
    }

    merged.push(item);
  }

  return merged;
}
