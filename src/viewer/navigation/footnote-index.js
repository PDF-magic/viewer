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

// Index note occurrences, preserving repeated numbers on different pages.
export function footnotesForPage(items, viewport, pageNumber) {
  const numbers = new Set();
  for (const item of items) {
    const match = item.str?.trim().match(/^(?:\[\s*(\d+)\s*\]|\(\s*(\d+)\s*\)|(\d+)(?:[.)]|\s|$))/);
    if (match) numbers.add(Number(match[1] || match[2] || match[3]));
  }
  const typicalHeight = median(items.map((item) => Math.abs(item.height || item.transform?.[3] || 0)));
  const notes = [];
  for (const number of numbers) {
    if (!Number.isSafeInteger(number) || number <= 0) continue;
    const target = candidateForPage(items, viewport, number, pageNumber, pageNumber);
    if (!target) continue;
    const marker = items.find((item) => {
      const point = pageCoordinates(item, viewport);
      return point && Math.abs(point.xRatio - target.xRatio) < 0.001 &&
        Math.abs(point.yRatio - target.yRatio) < 0.001 && markerPattern(number).test(item.str?.trim() || "");
    });
    const height = Math.abs(marker?.height || marker?.transform?.[3] || 0);
    // Body-size numbered lists are not enough evidence of a footnote.
    if (!(height > 0 && height <= typicalHeight * 0.9)) continue;
    notes.push({ ...target, number });
  }
  notes.sort((a, b) => a.yRatio - b.yRatio || a.xRatio - b.xRatio);
  return notes.map((note, index) => {
    const next = notes[index + 1];
    const text = items.filter((item) => {
      const point = pageCoordinates(item, viewport);
      if (!point || !item.str?.trim()) return false;
      const height = Math.abs(item.height || item.transform?.[3] || 0);
      return height <= typicalHeight * 0.9 && point.yRatio >= note.yRatio - 0.005 &&
        point.xRatio >= note.xRatio - 0.02 &&
        (!next || point.yRatio < next.yRatio - 0.005 ||
          (Math.abs(point.yRatio - next.yRatio) < 0.005 && point.xRatio < next.xRatio));
    }).map((item) => item.str.trim()).join(" ").replace(markerPattern(note.number), "").trim();
    return { ...note, text: text.slice(0, 1000) };
  }).filter((note) => note.text.length >= 3);
}
