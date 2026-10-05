export function normalizeSearchText(value) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\u200B-\u200D\u2060\uFEFF]+/gu, " ").trim();
}

export function prepareSearchText(value, normalizedQuery) {
  const normalizedValue = normalizeSearchText(value);

  if (!/^https?:\/\/\S+$/u.test(normalizedQuery)) {
    return normalizedValue;
  }

  return normalizedValue.replace(/\s+/g, "");
}
