function median(values) {
  const ordered = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!ordered.length) {
    return 0;
  }

  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function markerPattern(number) {
  return new RegExp(`^(?:\\[\\s*${number}\\s*\\]|\\(\\s*${number}\\s*\\)|${number}(?:[.)]|\\s|$))`);
}

function pageCoordinates(item, viewport) {
  if (!item?.transform || item.transform.length < 6) {
    return null;
  }

  const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
  return {
    x,
    y,
    xRatio: viewport.width ? x / viewport.width : 0,
    yRatio: viewport.height ? y / viewport.height : 0,
  };
}

export function candidateForPage(items, viewport, number, pageNumber, originPage) {
  const indexed = footnotesForPage(items, viewport, pageNumber).find((note) => note.number === number);
  if (indexed) return { ...indexed, score: 20 - Math.min(Math.abs(pageNumber - originPage) * 0.015, 1.5) };
  const pattern = markerPattern(number);
  const textItems = items.filter((item) => typeof item.str === "string" && item.str.trim());
  const typicalHeight = median(textItems.map((item) => Math.abs(item.height || item.transform?.[3] || 0)));
  let best;

  for (let index = 0; index < textItems.length; index += 1) {
    const item = textItems[index];
    const text = item.str.trim();
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const coordinates = pageCoordinates(item, viewport);
    if (!coordinates || coordinates.yRatio < 0.52 || coordinates.xRatio > 0.9) {
      continue;
    }

    const itemHeight = Math.abs(item.height || item.transform?.[3] || 0);
    const smallType = typicalHeight > 0 && itemHeight > 0 && itemHeight <= typicalHeight * 0.9;
    const remainder = text.slice(match[0].length).trim();
    const inlineText = remainder.length >= 3;

    const next = textItems[index + 1];
    const nextCoordinates = pageCoordinates(next, viewport);
    const sameLineThreshold = Math.max(0.012, typicalHeight / Math.max(viewport.height, 1) * 0.7);
    const adjacentText =
      Boolean(nextCoordinates) &&
      next.str.trim().length >= 3 &&
      nextCoordinates.xRatio >= coordinates.xRatio &&
      Math.abs(nextCoordinates.yRatio - coordinates.yRatio) <= sameLineThreshold;

    if (!smallType && coordinates.yRatio < 0.68 && !inlineText && !adjacentText) {
      continue;
    }

    let score = 0;
    if (inlineText) score += 4.5;
    if (adjacentText) score += 3.5;
    if (smallType) score += 2.5;
    if (coordinates.xRatio <= 0.45) score += 2;
    if (coordinates.yRatio >= 0.68) score += 1.5;
    if (coordinates.yRatio >= 0.8) score += 1.5;

    const looksLikeCenteredPageNumber =
      coordinates.xRatio >= 0.4 &&
      coordinates.xRatio <= 0.6 &&
      !inlineText &&
      !adjacentText;
    if (looksLikeCenteredPageNumber) {
      score -= 5;
    }

    score -= Math.min(Math.abs(pageNumber - originPage) * 0.015, 1.5);

    if (score < 5.5) {
      continue;
    }

    const candidate = {
      pageNumber,
      score,
      xRatio: coordinates.xRatio,
      yRatio: coordinates.yRatio,
      label: text,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

function positionedItems(items, viewport) {
  return items.filter((item) => typeof item.str === "string" && item.str.trim()).flatMap((item) => {
    const point = pageCoordinates(item, viewport);
    return point ? [{ ...point, item, text: item.str.trim(), height: Math.abs(item.height || item.transform?.[3] || 0) }] : [];
  });
}

function startsLine(entry, entries, baseline) {
  return !entries.some((other) => other !== entry && other.x < entry.x - 2 &&
    Math.abs(other.y - baseline) < Math.max(2, other.height * 0.2));
}

// Confirm isolated superscripts against their text baseline and an in-body reference.
// OCR word boxes alone are not reliable evidence of smaller footnote type.
export function footnotesForPage(items, viewport, pageNumber) {
  const entries = positionedItems(items, viewport);
  const bodyEntries = entries.filter((entry) => entry.yRatio < 0.5);
  const typicalHeight = median((bodyEntries.length ? bodyEntries : entries).map((entry) => entry.height));
  const notes = [];
  for (const entry of entries) {
    const match = entry.text.match(/^(?:\[\s*(\d+)\s*\]|\(\s*(\d+)\s*\)|(\d+)(?:[.)](?!\d)|\s|$))/);
    if (!match || entry.xRatio > 0.45) continue;
    const number = Number(match[1] || match[2] || match[3]);
    if (!Number.isSafeInteger(number) || number <= 0) continue;
    const inlineText = entry.text.slice(match[0].length).trim();
    const adjacent = entries.filter((other) => other !== entry && other.x > entry.x &&
      other.y >= entry.y - 2 && other.y - entry.y <= Math.max(3, other.height * 0.65) &&
      other.text.length >= 3).sort((a, b) => a.x - b.x)[0];
    if (!inlineText && !adjacent) continue;
    const baseline = inlineText ? entry.y : adjacent.y;
    if (!startsLine(entry, entries, baseline)) continue;
    const superscript = /^\d+$/.test(entry.text) && adjacent &&
      entry.height <= adjacent.height * 0.8 &&
      adjacent.y - entry.y >= adjacent.height * 0.15 &&
      adjacent.x - entry.x <= entry.height * (entry.text.length + 2);
    const reference = superscript && entries.some((other) => other !== entry &&
      other.text === entry.text && other.y < entry.y - entry.height &&
      other.height <= adjacent.height * 0.8 && entries.some((body) =>
        body !== other && body.x < other.x &&
        Math.abs(body.x + Math.abs(body.item.width || 0) - other.x) < adjacent.height &&
        body.y - other.y >= body.height * 0.15 && body.y - other.y <= body.height * 0.65));
    // Traditional smaller-type notes need a distinct lower-page block.
    const smallerBlock = entry.yRatio >= 0.52 && entry.height <= typicalHeight * 0.8 &&
      (inlineText || adjacent.height <= typicalHeight * 0.8);
    if (!reference && !smallerBlock) continue;
    notes.push({ pageNumber, number, xRatio: entry.xRatio, yRatio: entry.yRatio,
      label: entry.text, baseline, textHeight: inlineText ? entry.height : adjacent.height });
  }
  notes.sort((a, b) => a.yRatio - b.yRatio || a.xRatio - b.xRatio);
  return notes.map((note, index) => {
    const next = notes[index + 1];
    const noteEntries = entries.filter((entry) => {
      const withinNote = entry.y >= note.baseline - 2 &&
        (!next || entry.y < next.yRatio * viewport.height - 2);
      const sameType = Math.abs(entry.height - note.textHeight) <= note.textHeight * 0.15;
      // Exclude running footers and page counters from the preview.
      const footer = entry.yRatio > 0.92 && (/^(?:Page\s+)?\d+(?:\s+of\s+\d+)?$/i.test(entry.text) ||
        (entry.xRatio > 0.35 && entry.xRatio < 0.65));
      return withinNote && sameType && !footer && entry.xRatio >= note.xRatio - 0.02;
    }).sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y);
    const text = noteEntries.reduce((text, entry, index) => {
      const previous = noteEntries[index - 1];
      if (!previous) return entry.text;
      // PDF text runs can split a word at an apostrophe or a font change.
      const sameLine = Math.abs(previous.y - entry.y) < 2;
      const gap = entry.x - previous.x - Math.abs(previous.item.width || 0);
      const explicitSpace = /\s$/.test(previous.item.str) || /^\s/.test(entry.item.str);
      const contiguous = sameLine && Number.isFinite(previous.item.width) &&
        gap <= Math.max(previous.height, entry.height) * 0.18 && !explicitSpace;
      return text + (contiguous ? "" : " ") + entry.text;
    }, "").replace(markerPattern(note.number), "").trim();
    return { ...note, text };
  }).filter((note) => note.text.length >= 3);
}
