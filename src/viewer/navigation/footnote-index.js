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
      highlightRegions: [{ pageNumber, ...textRegion({ ...coordinates, height: itemHeight, item }, viewport) }],
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

function positionedItems(items, viewport) {
  const entries = items.filter((item) => typeof item.str === "string" && item.str.trim()).flatMap((item) => {
    const point = pageCoordinates(item, viewport);
    return point ? [{ ...point, item, text: item.str.trim(), height: Math.abs(item.height || item.transform?.[3] || 0) }] : [];
  });
  const footerEntries = new Set();
  // PDF text extraction can split a page counter into several spans, including
  // spans with different fonts. Exclude the whole footer line before indexing.
  for (const entry of entries) {
    if (entry.yRatio < 0.8 || footerEntries.has(entry)) continue;
    const line = entries.filter((other) => Math.abs(other.y - entry.y) <= Math.max(other.height, entry.height) * 0.4)
      .sort((a, b) => a.x - b.x);
    if (/^(?:Page\s*)?\d+\s*of\s*\d+$/i.test(joinNoteEntries(line))) {
      for (const fragment of line) footerEntries.add(fragment);
    }
  }
  return entries.filter((entry) => !footerEntries.has(entry));
}

function textRegion(entry, viewport) {
  return {
    left: entry.x / viewport.width,
    top: (entry.y - entry.height) / viewport.height,
    width: Math.max(entry.item.width || entry.height, 1) / viewport.width,
    height: entry.height * 1.2 / viewport.height,
  };
}

function highlightRegions(entries, viewport, pageNumber) {
  const lines = [];
  for (const entry of entries) {
    const region = textRegion(entry, viewport);
    const line = lines.find((line) => Math.abs(line.baseline - readingBaseline(entry)) <= entry.height * 0.6);
    if (line) {
      const right = Math.max(line.left + line.width, region.left + region.width);
      const bottom = Math.max(line.top + line.height, region.top + region.height);
      line.left = Math.min(line.left, region.left);
      line.top = Math.min(line.top, region.top);
      line.width = right - line.left;
      line.height = bottom - line.top;
    } else {
      lines.push({ ...region, baseline: readingBaseline(entry) });
    }
  }
  return lines.map(({ baseline, ...region }) => ({ pageNumber, ...region }));
}

function readingBaseline(entry) {
  // OCR words on a tilted scan share a sloped baseline. Compare their
  // deskewed positions while retaining original coordinates for highlights.
  const transform = entry.item.transform;
  const slope = transform?.[0] ? transform[1] / transform[0] : 0;
  return entry.y + (Math.abs(slope) < 0.1 ? entry.x * slope : 0);
}

function readingOrder(a, b) {
  const difference = readingBaseline(a) - readingBaseline(b);
  return Math.abs(difference) < 2 ? a.x - b.x : difference;
}

function joinNoteEntries(entries) {
  return entries.reduce((text, entry, index) => {
    const previous = entries[index - 1];
    if (!previous) return entry.text;
    const sameLine = Math.abs(readingBaseline(previous) - readingBaseline(entry)) < 2;
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
  // Font changes split a visual line into PDF items. Count the connected line,
  // otherwise repeated inline fragments can masquerade as another column.
  const visualLines = [];
  for (const entry of [...entries].sort(readingOrder)) {
    if (entry.yRatio <= 0.1) continue;
    const right = entry.x + Math.abs(entry.item.width || 0);
    const line = visualLines.find(line => Math.abs(line.y - entry.y) < 2 &&
      entry.x >= line.left && entry.x - line.right <= Math.max(line.height, entry.height));
    if (line) line.right = Math.max(line.right, right);
    else visualLines.push({ left: entry.x, right, y: entry.y, height: entry.height });
  }
  const wideLines = visualLines.filter(line => line.right - line.left > viewport.width * 0.55).length;
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
  // Link underlines and strike-throughs are drawing paths too. A separator
  // sits between lines, rather than touching a text baseline.
  rules = rules.filter(rule => !entries.some(entry =>
    Math.abs(rule.y - entry.y) <= entry.height * 0.3 &&
    rule.x < entry.x + Math.abs(entry.item.width || 0) && rule.x + rule.width > entry.x));
  const columns = columnsForPage(entries, viewport, rules);
  return columns.map((column) => ({ ...column,
    entries: entries.filter((entry) => entry.x >= column.left && entry.x < column.right),
    rules: rules.filter((rule) => rule.x >= column.left && rule.x < column.right &&
      (columns.length === 1 || rule.width < (column.right - column.left) * 0.65)),
  }));
}

function scannedHangingNotes(column, viewport, expectedNumber) {
  const separator = [...column.rules].sort((a, b) => a.y - b.y)[0];
  if (!separator || separator.y < viewport.height * 0.5) return [];
  const below = column.entries.filter(entry => entry.y > separator.y + 2 && entry.yRatio < 0.92);
  const markers = below.filter(entry => entry.text.length <= 3 &&
    Math.abs(entry.x - separator.x) < 8 && entry.item.width < 18);
  const text = below.filter(entry => entry.x > separator.x + 24 && /[A-Za-z]/.test(entry.text));
  const lines = [];
  const textHeight = median(text.map(entry => entry.height));
  for (const entry of text.filter(entry => entry.height >= textHeight * 0.85).sort(readingOrder)) {
    const line = lines.find(line => Math.abs(line.y - entry.y) < 2);
    if (line) line.entries.push(entry);
    else lines.push({ y: entry.y, entries: [entry] });
  }
  if (!lines.length || (!markers.length && !Number.isSafeInteger(expectedNumber))) return [];
  const margin = Math.min(...text.map(entry => entry.x));
  const height = median(text.map(entry => entry.height));
  // OCR can omit labels entirely, or give a tiny printed digit the text and
  // height of a comma/quote. Require a consistent hanging block and label gutter.
  if (margin - separator.x > 48 || lines.some(line =>
    Math.abs(Math.min(...line.entries.map(entry => entry.x)) - margin) > 3) ||
    lines[0].y - separator.y > height * 2.5) return [];
  if (!markers.some(marker => !/^\d+$/.test(marker.text) || marker.height > height) &&
    !Number.isSafeInteger(expectedNumber) && !markers.some(marker => marker.text === "2")) return [];
  const starts = [];
  let quotedBlock = false;
  for (const [index, line] of lines.entries()) {
    const marker = markers.find(marker => Math.abs(marker.y - line.y) <= height * 0.8 &&
      lines.reduce((closest, candidate) => Math.abs(candidate.y - marker.y) < Math.abs(closest.y - marker.y)
        ? candidate : closest, lines[0]) === line);
    const previous = lines[index - 1];
    const gap = previous && line.y - previous.y >= height * 1.45;
    if (!index || marker || (gap && !quotedBlock)) {
      starts.push({ line, marker });
      quotedBlock = false;
    }
    if (/:$/.test(joinNoteEntries(line.entries))) quotedBlock = true;
  }
  const anchor = starts.findIndex(start => /^\d+$/.test(start.marker?.text || ""));
  let number = expectedNumber ?? (anchor >= 0 ? Number(starts[anchor].marker.text) - anchor : undefined);
  if (!Number.isSafeInteger(number) || number < 1) return [];
  // A readable label must agree with the recovered sequence.
  if (starts.some((start, index) => /^\d+$/.test(start.marker?.text || "") &&
    Number(start.marker.text) !== number + index)) return [];
  return starts.map(({ line, marker }) => {
    const entry = marker || line.entries[0];
    return { number: number++, xRatio: entry.xRatio, yRatio: line.y / viewport.height,
      label: marker?.text || "", baseline: line.y, textHeight: height,
      columnIndex: column.index, columnLeft: column.left, columnRight: column.right,
      inferredMarker: marker?.text || "", hangingMargin: margin };
  });
}

// Detect and collect each column independently, then traverse columns left to right.
export function footnotesForPage(items, viewport, pageNumber, rules = [], referenceContext, expectedNumber) {
  const result = [];
  const layout = pageLayout(items, viewport, rules);
  let nextExpectedNumber = expectedNumber;
  const allEntries = positionedItems(items, viewport);
  if (referenceContext) allEntries.push(...positionedItems(referenceContext.items, referenceContext.viewport)
    .map((entry) => ({ ...entry, priorPage: true })));
  for (const column of layout) {
    const entries = column.entries;
    const bodyEntries = entries.filter((entry) => entry.yRatio < 0.5);
    const typicalHeight = median((bodyEntries.length ? bodyEntries : entries).map((entry) => entry.height));
    const notes = [];
    for (const entry of entries) {
      const match = entry.text.match(/^(?:\[\s*(\d+)\s*\]|\(\s*(\d+)\s*\)|(\d+)(?:[.)](?!\d)|\s|$))/);
      if (!match) continue;
      const number = Number(match[1] || match[2] || match[3]);
      if (!Number.isSafeInteger(number) || number <= 0) continue;
      const sameLineFooterText = entries.some((other) => other !== entry && other.text.length >= 3 &&
        Math.abs(other.y - entry.y) <= Math.max(2, entry.height * 0.4));
      const edgePageNumber = /^\d+$/.test(entry.text) && number === pageNumber &&
        entry.yRatio >= 0.94 && (entry.xRatio <= 0.08 || entry.xRatio >= 0.92) && sameLineFooterText;
      if (edgePageNumber || entry.x > column.left + (column.right - column.left) * 0.45) continue;
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
      // A definition label can sit on the note-text baseline even when its
      // matching body reference is superscripted. Treat that confirmed body
      // reference as sufficient evidence without requiring the label itself
      // to be raised.
      const reference = Boolean(adjacent) && allEntries.some((other) => other !== entry && other.text === entry.text &&
        (other.priorPage || other.y < entry.y - entry.height) && other.height <= adjacent.height * 0.8 && allEntries.some((body) =>
          body !== other && body.height >= adjacent.height * 0.95 && Boolean(body.priorPage) === Boolean(other.priorPage) &&
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
      const scanPreviousLine = entries.filter(other => readingBaseline(other) < readingBaseline(entry) - 2)
        .sort((a, b) => readingBaseline(b) - readingBaseline(a))[0];
      const scanSeparated = !scanPreviousLine ||
        readingBaseline(entry) - readingBaseline(scanPreviousLine) >= typicalHeight * 1.5;
      // Plain numbers beginning a small-text block may be dates or release
      // citations continued from another column. Inline markers need an
      // explicit delimiter or an established note block in this column.
      const inlineMarker = !inlineText || /^[\[(]|^\d+\.(?!\d)/.test(entry.text) ||
        notes.some((note) => Math.abs(note.xRatio - entry.xRatio) * viewport.width < 2 &&
          Math.abs(note.textHeight - entry.height) < entry.height * 0.15);
      const smallerBlock = inlineMarker && !column.rules.length && separated && entry.yRatio >= 0.52 && entry.height <= typicalHeight * 0.8 &&
        (inlineText || adjacent.height <= typicalHeight * 0.8);
      // Scan OCR can flatten the superscript label and omit the separator.
      // Recover a slightly smaller, multi-line paragraph at the page bottom.
      const scannedSmallBlock = !column.rules.length && !inlineText && scanSeparated &&
        entry.yRatio >= 0.8 && entry.height <= typicalHeight * 0.9 &&
        adjacent.height <= typicalHeight * 0.9 && entries.filter(other =>
          readingBaseline(other) > readingBaseline(entry) + entry.height * 0.8 &&
          readingBaseline(other) < readingBaseline(entry) + entry.height * 4 &&
          other.x < adjacent.x && Math.abs(other.height - adjacent.height) < adjacent.height * 0.1 &&
          /[A-Za-z]/.test(other.text)).length >= 2;
      if (column.rules.length && !rule) continue;
      if (!reference && !wideNoteBlock && !(superscript && rule) && !smallerBlock && !scannedSmallBlock) continue;
      notes.push({ pageNumber, number, xRatio: entry.xRatio, yRatio: entry.yRatio, label: entry.text,
        baseline, scannedSmallBlock, readingY: readingBaseline(inlineText ? entry : adjacent),
        textHeight: inlineText ? entry.height : adjacent.height, columnIndex: column.index,
        columnLeft: column.left, columnRight: column.right });
    }
    // Some scanned SEC filings render a numeric footnote label correctly while
    // exposing punctuation or letter-like OCR text to PDF.js. Once the document
    // has established a numeric sequence, recover those labels only inside a
    // single-column footnote block with a real separator rule.
    if (layout.length === 1 && Number.isSafeInteger(nextExpectedNumber) && column.rules.length) {
      const separator = [...column.rules].sort((a, b) => a.y - b.y)[0];
      const knownBaselines = new Set(notes.map((note) => Math.round(note.baseline)));
      const anonymous = entries.filter((entry) => {
        if (entry.y <= separator.y + 2 || entry.yRatio >= 0.94 || entry.text.length > 3 ||
          /^\d/.test(entry.text) || knownBaselines.has(Math.round(entry.y))) return false;
        if (Math.abs(entry.x - separator.x) > Math.max(8, typicalHeight)) return false;
        const adjacent = entries.filter((other) => other !== entry && other.x > entry.x &&
          other.y >= entry.y - 2 && other.y - entry.y <= Math.max(3, other.height * 0.65) &&
          other.text.length >= 3 && /[A-Za-z\u00c0-\u02af]/u.test(other.text))
          .sort((a, b) => a.x - b.x)[0];
        return Boolean(adjacent) && entry.height <= typicalHeight * 0.9 &&
          adjacent.height <= typicalHeight * 0.9;
      }).sort((a, b) => a.y - b.y);

      const starts = [
        ...notes.map((note) => ({ y: note.yRatio * viewport.height, note })),
        ...anonymous.map((entry) => ({ y: entry.y, entry })),
      ].sort((a, b) => a.y - b.y);
      for (const start of starts) {
        if (start.note) {
          if (start.note.number >= nextExpectedNumber) nextExpectedNumber = start.note.number + 1;
          continue;
        }
        const entry = start.entry;
        const adjacent = entries.filter((other) => other !== entry && other.x > entry.x &&
          other.y >= entry.y - 2 && other.y - entry.y <= Math.max(3, other.height * 0.65) &&
          other.text.length >= 3 && /[A-Za-z\u00c0-\u02af]/u.test(other.text))
          .sort((a, b) => a.x - b.x)[0];
        notes.push({ pageNumber, number: nextExpectedNumber, xRatio: entry.xRatio, yRatio: entry.yRatio,
          label: entry.text, baseline: adjacent.y, textHeight: adjacent.height, columnIndex: column.index,
          columnLeft: column.left, columnRight: column.right, inferredMarker: entry.text });
        nextExpectedNumber += 1;
      }
    }

    const scannedNotes = layout.length === 1 ? scannedHangingNotes(column, viewport, expectedNumber) : [];
    if (scannedNotes.length) notes.splice(0, notes.length, ...scannedNotes.map(note => ({ ...note, pageNumber })));
    notes.sort((a, b) => a.yRatio - b.yRatio);
    for (const [index, note] of notes.entries()) {
      const next = notes[index + 1];
      // Table notes can occupy the full page width above resumed body columns.
      // A larger-type body line ends that note block even if more small text follows.
      const resumedBody = entries.filter((entry) => entry.y > note.baseline + 2 &&
        (note.hangingMargin === undefined || entry.x >= note.hangingMargin - 3) &&
        entry.height > note.textHeight * 1.2).sort(readingOrder)[0];
      const textEntries = entries.filter((entry) => (note.readingY === undefined ? entry.y : readingBaseline(entry)) >= (note.readingY ?? note.baseline) - 2 &&
        (note.hangingMargin === undefined || entry.x >= note.hangingMargin - 3) &&
        (!resumedBody || entry.y < resumedBody.y - 2) &&
        (!next || (next.readingY === undefined ? entry.y : readingBaseline(entry)) < (next.readingY ?? next.yRatio * viewport.height) - 2) && isPreviewText(entry, note.textHeight) &&
        !(/^\d+$/.test(entry.text) && entry.yRatio > 0.92 && !(note.scannedSmallBlock && entries.some(other =>
          other !== entry && /[A-Za-z]/.test(other.text) &&
          Math.abs(readingBaseline(other) - readingBaseline(entry)) < 2)))).sort(readingOrder);
      const joinedText = joinNoteEntries(textEntries.filter(entry =>
        !(entry.text === String(note.number) && entry.xRatio === note.xRatio && entry.yRatio === note.yRatio)));
      const text = (note.inferredMarker && joinedText.startsWith(note.inferredMarker)
        ? joinedText.slice(note.inferredMarker.length)
        : joinedText.replace(markerPattern(note.number), "")).trim();
      const marker = entries.find((entry) => entry.xRatio === note.xRatio &&
        (note.hangingMargin === undefined ? entry.yRatio === note.yRatio :
          entry.text === note.inferredMarker && Math.abs(entry.y - note.baseline) <= note.textHeight * 0.8));
      const highlightedEntries = marker && !textEntries.includes(marker) ? [marker, ...textEntries] : textEntries;
      if (text.length >= 3) result.push({ ...note, text, endPageNumber: pageNumber, endColumnIndex: column.index,
        highlightRegions: highlightRegions(highlightedEntries, viewport, pageNumber),
        continues: !next && textEntries.at(-1)?.yRatio >= 0.88 &&
          ((note.hangingMargin === undefined && !note.scannedSmallBlock) || !/[.!?]["')\]]?$/.test(text)) });
    }
  }
  return result;
}

function continuationInColumn(column, viewport, previousNote, pageNotes, pageNumber = previousNote.endPageNumber + 1) {
  const firstNote = pageNotes.find((note) => note.columnIndex === column.index);
  const separator = column.rules.sort((a, b) => a.y - b.y)[0];
  if (!separator) return null;
  const entries = column.entries.filter((entry) => entry.y > separator.y + 2 &&
    (!firstNote || entry.y < firstNote.yRatio * viewport.height - 2) && isPreviewText(entry, previousNote.textHeight))
    .sort(readingOrder);
  const text = joinNoteEntries(entries);
  return text ? { text, highlightRegions: highlightRegions(entries, viewport, pageNumber),
    continues: !firstNote && entries.at(-1)?.yRatio >= 0.88 } : null;
}

export function footnoteContinuationForPage(items, viewport, operatorList, previousNote, pageNotes, operatorIds) {
  const rules = footnoteRulesForPage(operatorList, viewport, operatorIds);
  return continuationInColumn(pageLayout(items, viewport, rules)[0], viewport, previousNote, pageNotes);
}

export function appendFootnotesForPage(index, items, viewport, pageNumber, operatorList, operatorIds, referenceContext) {
  const rules = footnoteRulesForPage(operatorList, viewport, operatorIds);
  const previousNumber = [...index].reverse().find((note) => Number.isSafeInteger(note.number))?.number;
  const expectedNumber = Number.isSafeInteger(previousNumber) ? previousNumber + 1 : undefined;
  const pageNotes = footnotesForPage(items, viewport, pageNumber, rules, referenceContext, expectedNumber);
  for (const column of pageLayout(items, viewport, rules)) {
    const previous = index.at(-1);
    const adjacent = previous && (previous.endPageNumber === pageNumber - 1 && column.index === 0 ||
      previous.endPageNumber === pageNumber && previous.endColumnIndex === column.index - 1);
    if (previous?.continues && adjacent) {
      const continuation = continuationInColumn(column, viewport, previous, pageNotes, pageNumber);
      previous.continues = Boolean(continuation?.continues);
      if (continuation) {
        previous.text += ` ${continuation.text}`;
        previous.highlightRegions.push(...continuation.highlightRegions);
        previous.endPageNumber = pageNumber;
        previous.endColumnIndex = column.index;
      }
    }
    index.push(...pageNotes.filter((note) => note.columnIndex === column.index));
  }
}
