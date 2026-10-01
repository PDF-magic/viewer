export function normalizeSearchText(value) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function prepareSearchText(value, normalizedQuery) {
  const normalizedValue = normalizeSearchText(value);

  if (!/^https?:\/\/\S+$/u.test(normalizedQuery)) {
    return normalizedValue;
  }

  return normalizedValue.replace(/\s+/g, "");
}
