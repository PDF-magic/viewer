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

function readingOrder(a, b) {
  return Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y;
}

function joinNoteEntries(entries) {
  return entries.reduce((text, entry, index) => {
    const previous = entries[index - 1];
    if (!previous) return entry.text;
    const sameLine = Math.abs(previous.y - entry.y) < 2;
    const gap = entry.x - previous.x - Math.abs(previous.item.width || 0);
    const explicitSpace = /\s$/.test(previous.item.str) || /^\s/.test(entry.item.str);
    const contiguous = sameLine && Number.isFinite(previous.item.width) &&
      gap <= Math.max(previous.height, entry.height) * 0.18 && !explicitSpace;
    return text + (contiguous ? "" : " ") + entry.text;
  }, "").trim();
}

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

export function footnoteRulesForPage(operatorList, viewport, operatorIds) {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [], rules = [];
  for (let index = 0; index < (operatorList?.argsArray.length || 0); index += 1) {
    const args = operatorList.argsArray[index];
    const fn = operatorList.fnArray?.[index];
    if (operatorIds && fn === operatorIds.save) { stack.push([...matrix]); continue; }
    if (operatorIds && fn === operatorIds.restore) { matrix = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
    if (operatorIds && fn === operatorIds.transform) { matrix = multiply(matrix, args); continue; }
    if (operatorIds && fn !== operatorIds.constructPath) continue;
    const bounds = args?.[2];
    if (!Array.isArray(args?.[1]) || bounds?.length !== 4 ||
      !args[1].some((path) => Array.isArray(path) || ArrayBuffer.isView(path))) continue;
    const point = (x, y) => viewport.convertToViewportPoint(matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]);
    const [x1, y1] = point(bounds[0], bounds[1]), [x2, y2] = point(bounds[2], bounds[3]);
    const width = Math.abs(x2 - x1), y = Math.min(y1, y2);
    if (Math.abs(y2 - y1) <= 2 && width >= viewport.width * 0.06 && width <= viewport.width * 0.6 &&
      y >= viewport.height * 0.2 && y < viewport.height * 0.96) rules.push({ x: Math.min(x1, x2), y, width });
  }
  return rules;
}

function columnsForPage(entries, viewport, rules) {
  const counts = new Map();
  for (const entry of entries) {
    if (entry.yRatio < 0.1 || entry.yRatio > 0.95 || entry.item.width < viewport.width * 0.15 ||
      entry.item.width > viewport.width * 0.4) continue;
    const x = Math.round(entry.x / 3) * 3;
    counts.set(x, (counts.get(x) || 0) + 1);
  }
  const starts = [];
  const candidates = [...rules.map((rule) => rule.x), ...[...counts].filter(([, count]) => count >= 8).map(([x]) => x)].sort((a, b) => a - b);
  for (const x of candidates) if (!starts.length || x - starts.at(-1) > viewport.width * 0.18) starts.push(x);
  // Wide body lines indicate a single-column document, despite short text fragments.
  const wideLines = entries.filter((entry) => entry.yRatio > 0.1 && entry.item.width > viewport.width * 0.55).length;
  const distinctRules = new Set(rules.map((rule) => Math.round(rule.x / 12))).size;
  if (starts.length < 2 || (wideLines >= 5 && distinctRules < 2)) return [{ index: 0, left: 0, right: viewport.width, margin: rules[0]?.x || 0 }];
  return starts.map((x, index) => ({ index, left: Math.max(0, x - 12), right: (starts[index + 1] || viewport.width + 12) - 12, margin: x }));
}

function isPreviewText(entry, height) {
  if (entry.yRatio > 0.96 || /^(?:Page\s+)?\d+\s+of\s+\d+$/i.test(entry.text)) return false;
  return Math.abs(entry.height - height) <= height * 0.15;
}

function pageLayout(items, viewport, rules) {
  const entries = positionedItems(items, viewport);
  const columns = columnsForPage(entries, viewport, rules);
  return columns.map((column) => ({ ...column,
    entries: entries.filter((entry) => entry.x >= column.left && entry.x < column.right),
    rules: rules.filter((rule) => rule.x >= column.left && rule.x < column.right &&
      (columns.length === 1 || rule.width < (column.right - column.left) * 0.65)),
  }));
}

// Detect and collect each column independently, then traverse columns left to right.
export function footnotesForPage(items, viewport, pageNumber, rules = [], referenceContext) {
  const result = [];
  const allEntries = positionedItems(items, viewport);
  if (referenceContext) allEntries.push(...positionedItems(referenceContext.items, referenceContext.viewport)
    .map((entry) => ({ ...entry, priorPage: true })));
  for (const column of pageLayout(items, viewport, rules)) {
    const entries = column.entries;
    const bodyEntries = entries.filter((entry) => entry.yRatio < 0.5);
    const typicalHeight = median((bodyEntries.length ? bodyEntries : entries).map((entry) => entry.height));
    const notes = [];
    for (const entry of entries) {
      const match = entry.text.match(/^(?:\[\s*(\d+)\s*\]|\(\s*(\d+)\s*\)|(\d+)(?:[.)](?!\d)|\s|$))/);
      if (!match || entry.x > column.left + (column.right - column.left) * 0.45) continue;
      const number = Number(match[1] || match[2] || match[3]);
      if (!Number.isSafeInteger(number) || number <= 0) continue;
      const inlineText = entry.text.slice(match[0].length).trim();
      const adjacent = entries.filter((other) => other !== entry && other.x > entry.x &&
        other.y >= entry.y - 2 && other.y - entry.y <= Math.max(3, other.height * 0.65) && other.text.length >= 3 && /[A-Za-z\u00c0-\u02af]/u.test(other.text))
        .sort((a, b) => a.x - b.x)[0];
      if (!inlineText && !adjacent) continue;
      const baseline = inlineText ? entry.y : adjacent.y;
      if (entries.some((other) => other !== entry && other.x < entry.x - 2 &&
        Math.abs(other.y - baseline) < Math.max(2, other.height * 0.2))) continue;
      const superscript = /^\d+$/.test(entry.text) && adjacent && entry.height <= adjacent.height * 0.8 &&
        adjacent.y - entry.y >= adjacent.height * 0.15 && adjacent.x - entry.x <= entry.height * (entry.text.length + 2);
      const reference = superscript && allEntries.some((other) => other !== entry && other.text === entry.text &&
        (other.priorPage || other.y < entry.y - entry.height) && other.height <= adjacent.height * 0.8 && allEntries.some((body) =>
          body !== other && Boolean(body.priorPage) === Boolean(other.priorPage) &&
          ((body.x < other.x && Math.abs(body.x + Math.abs(body.item.width || 0) - other.x) < adjacent.height) ||
            (body.x > other.x && body.x - other.x - Math.abs(other.item.width || 0) < adjacent.height)) &&
          body.y - other.y >= body.height * 0.15 && body.y - other.y <= body.height * 0.65));
      const wideNoteBlock = superscript && adjacent.item.width > viewport.width * 0.55 &&
        entries.some((other) => other !== entry && /^\d+$/.test(other.text) &&
          Math.abs(other.x - entry.x) < 2 && Math.abs(other.height - entry.height) < 0.1 &&
          Math.abs(other.y - entry.y) < adjacent.height * 6 && entries.some((line) =>
            line.x > other.x && line.y > other.y && line.y - other.y < adjacent.height * 0.65 &&
            line.item.width > viewport.width * 0.55));
      const rule = column.rules.find((rule) => rule.y < entry.y && entry.y - rule.y > 2);
      const previousLine = entries.filter((other) => other.y < entry.y - 2).sort((a, b) => b.y - a.y)[0];
      const separated = !previousLine || entry.y - previousLine.y >= typicalHeight * 1.5;
      // Plain numbers beginning a small-text block may be dates or release
      // citations continued from another column. Inline markers need an
      // explicit delimiter or an established note block in this column.
      const inlineMarker = !inlineText || /^[\[(]|^\d+\.(?!\d)/.test(entry.text) ||
        notes.some((note) => Math.abs(note.xRatio - entry.xRatio) * viewport.width < 2 &&
          Math.abs(note.textHeight - entry.height) < entry.height * 0.15);
      const smallerBlock = inlineMarker && !column.rules.length && separated && entry.yRatio >= 0.52 && entry.height <= typicalHeight * 0.8 &&
        (inlineText || adjacent.height <= typicalHeight * 0.8);
      if (column.rules.length && !rule) continue;
      if (!reference && !wideNoteBlock && !(superscript && rule) && !smallerBlock) continue;
      notes.push({ pageNumber, number, xRatio: entry.xRatio, yRatio: entry.yRatio, label: entry.text,
        baseline, textHeight: inlineText ? entry.height : adjacent.height, columnIndex: column.index,
        columnLeft: column.left, columnRight: column.right });
    }
    notes.sort((a, b) => a.yRatio - b.yRatio);
    for (const [index, note] of notes.entries()) {
      const next = notes[index + 1];
      // Table notes can occupy the full page width above resumed body columns.
      // A larger-type body line ends that note block even if more small text follows.
      const resumedBody = entries.filter((entry) => entry.y > note.baseline + 2 &&
        entry.height > note.textHeight * 1.2).sort(readingOrder)[0];
      const textEntries = entries.filter((entry) => entry.y >= note.baseline - 2 &&
        (!resumedBody || entry.y < resumedBody.y - 2) &&
        (!next || entry.y < next.yRatio * viewport.height - 2) && isPreviewText(entry, note.textHeight) &&
        !(/^\d+$/.test(entry.text) && entry.yRatio > 0.92)).sort(readingOrder);
      const text = joinNoteEntries(textEntries).replace(markerPattern(note.number), "").trim();
      if (text.length >= 3) result.push({ ...note, text, endPageNumber: pageNumber, endColumnIndex: column.index,
        continues: !next && textEntries.at(-1)?.yRatio >= 0.88 });
    }
  }
  return result;
}

function continuationInColumn(column, viewport, previousNote, pageNotes) {
  const firstNote = pageNotes.find((note) => note.columnIndex === column.index);
  const separator = column.rules.sort((a, b) => a.y - b.y)[0];
  if (!separator) return null;
  const entries = column.entries.filter((entry) => entry.y > separator.y + 2 &&
    (!firstNote || entry.y < firstNote.yRatio * viewport.height - 2) && isPreviewText(entry, previousNote.textHeight))
    .sort(readingOrder);
  const text = joinNoteEntries(entries);
  return text ? { text, continues: !firstNote && entries.at(-1)?.yRatio >= 0.88 } : null;
}

export function footnoteContinuationForPage(items, viewport, operatorList, previousNote, pageNotes, operatorIds) {
  const rules = footnoteRulesForPage(operatorList, viewport, operatorIds);
  return continuationInColumn(pageLayout(items, viewport, rules)[0], viewport, previousNote, pageNotes);
}

export function appendFootnotesForPage(index, items, viewport, pageNumber, operatorList, operatorIds, referenceContext) {
  const rules = footnoteRulesForPage(operatorList, viewport, operatorIds);
  const pageNotes = footnotesForPage(items, viewport, pageNumber, rules, referenceContext);
  for (const column of pageLayout(items, viewport, rules)) {
    const previous = index.at(-1);
    const adjacent = previous && (previous.endPageNumber === pageNumber - 1 && column.index === 0 ||
      previous.endPageNumber === pageNumber && previous.endColumnIndex === column.index - 1);
    if (previous?.continues && adjacent) {
      const continuation = continuationInColumn(column, viewport, previous, pageNotes);
      previous.continues = Boolean(continuation?.continues);
      if (continuation) {
        previous.text += ` ${continuation.text}`;
        previous.endPageNumber = pageNumber;
        previous.endColumnIndex = column.index;
      }
    }
    index.push(...pageNotes.filter((note) => note.columnIndex === column.index));
  }
}
