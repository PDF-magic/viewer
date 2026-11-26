import { markdownFromRuns } from './markdown-copy.js';

// PDFs position font runs rather than expose HTML paragraphs. Prefer the PDF
// semantic blocks; otherwise identify nearby lines in one visual column.
function spanItems(spans) {
  return spans.flatMap((span, index) => {
    const text = span.textContent || '';
    const rect = span.getBoundingClientRect();
    return text.trim() && rect.width > 0 && rect.height > 0
      ? [{ span, index, text, left: rect.left, right: rect.right,
        top: rect.top, bottom: rect.bottom, height: rect.height }] : [];
  });
}

function sameLine(line, item) {
  const overlap = Math.min(line.bottom, item.bottom) - Math.max(line.top, item.top);
  const verticalMatch = overlap > Math.min(line.height, item.height) * 0.5;
  const gap = Math.max(line.left - item.right, item.left - line.right, 0);
  return verticalMatch && gap <= Math.max(12, Math.min(line.height, item.height) * 2.2);
}

function visualLines(items) {
  const lines = [];
  for (const item of [...items].sort((a, b) => a.top - b.top || a.left - b.left)) {
    let line = lines.find(candidate => sameLine(candidate, item));
    if (!line) {
      line = { items: [], left: item.left, right: item.right, top: item.top,
        bottom: item.bottom, height: item.height };
      lines.push(line);
    }
    line.items.push(item);
    line.left = Math.min(line.left, item.left);
    line.right = Math.max(line.right, item.right);
    line.top = Math.min(line.top, item.top);
    line.bottom = Math.max(line.bottom, item.bottom);
    line.height = line.bottom - line.top;
  }
  for (const line of lines) line.items.sort((a, b) => a.left - b.left || a.index - b.index);
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

function continuesParagraph(previous, next) {
  const height = Math.max(previous.height, next.height);
  const separation = next.top - previous.top;
  if (separation < height * 0.55 || separation > height * 1.95) return false;
  if (next.items.some(item => item.span.dataset.markdownParagraphStart === 'true')) return false;
  if ([...previous.items, ...next.items].some(item => item.span.dataset.copyBlock !== undefined)) return false;
  // Exclude other columns, marginalia, and differently sized headings.
  if (Math.min(previous.right, next.right) - Math.max(previous.left, next.left) <= 0) return false;
  if (Math.abs(next.left - previous.left) > height * 5) return false;
  if (Math.max(previous.height, next.height) / Math.min(previous.height, next.height) > 1.55) return false;
  // First-line indentation marks a new paragraph; dedenting a wrapped
  // second line is expected.
  if (next.left - previous.left > height * 1.7) return false;
  // A short sentence-ending line followed by a full line at the same margin
  // is often an unindented paragraph boundary.
  const previousText = previous.items.map(item => item.text).join('');
  if (/[.!?][”"')\]]?\s*$/.test(previousText) &&
      previous.right - previous.left > height * 5 &&
      Math.abs(next.left - previous.left) < height * 1.2 &&
      previous.right < next.right - height * 3 &&
      previous.right - previous.left < (next.right - next.left) * 0.75) return false;
  return true;
}

export function paragraphAtSpan(spans, clickedSpan) {
  const items = spanItems(spans);
  const clicked = items.find(item => item.span === clickedSpan);
  if (!clicked) return null;
  const block = clickedSpan.dataset.copyBlock;
  if (block !== undefined) {
    const tagged = items.filter(item => item.span.dataset.copyBlock === block);
    if (tagged.length) return { lines: visualLines(tagged), spans: tagged.map(item => item.span) };
  }

  const lines = visualLines(items);
  const anchor = lines.find(line => line.items.some(item => item.span === clickedSpan));
  if (!anchor) return null;
  // Do not let a parallel column interrupt this paragraph's line sequence.
  const columnLines = lines.filter(line =>
    Math.abs(line.left - anchor.left) < Math.max(line.height, anchor.height) * 6 &&
    Math.min(line.right, anchor.right) > Math.max(line.left, anchor.left));
  const index = columnLines.indexOf(anchor);
  let start = index, end = index;
  while (start > 0 && continuesParagraph(columnLines[start - 1], columnLines[start])) start--;
  while (end < columnLines.length - 1 && continuesParagraph(columnLines[end], columnLines[end + 1])) end++;
  const paragraphLines = columnLines.slice(start, end + 1);
  return { lines: paragraphLines, spans: paragraphLines.flatMap(line => line.items.map(item => item.span)) };
}

export function paragraphCopyText(lines, markdown = false) {
  const runs = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const items = lines[lineIndex].items;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const prior = items[index - 1];
      const gap = prior ? item.left - prior.right : 0;
      runs.push({
        text: item.text,
        bold: item.span.dataset.markdownBold === 'true',
        italic: item.span.dataset.markdownItalic === 'true',
        newLine: lineIndex > 0 && index === 0,
        // The bounds are already one paragraph: reflow visual lines into
        // spaces even when the source PDF is not tagged.
        role: 'P', block: 'clicked-paragraph',
        spaceBefore: item.span.dataset.markdownSpaceBefore === 'true' ||
          (prior && gap > Math.max(1, Math.min(prior.height, item.height) * 0.12)),
      });
    }
  }
  return markdownFromRuns(runs, { markdown, reflow: true }).trim();
}

function selectParagraph(doc, layer, spans) {
  const ordered = [...layer.querySelectorAll('[data-markdown-item]')];
  const indices = spans.map(span => ordered.indexOf(span)).filter(index => index >= 0);
  if (!indices.length) return false;
  const range = doc.createRange();
  range.setStartBefore(ordered[Math.min(...indices)]);
  range.setEndAfter(ordered[Math.max(...indices)]);
  const selection = doc.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function installParagraphDoubleClick(root, markdownToggle, doc = document, view = window) {
  if (!root) return;
  let pendingCopy = null;
  // Installed after the regular copy formatter. Override just this gesture's
  // copy with visual paragraph order and optional Markdown formatting.
  doc.addEventListener('copy', event => {
    if (!pendingCopy || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', pendingCopy.text);
    if (pendingCopy.markdown) event.clipboardData.setData('text/markdown', pendingCopy.text);
    event.preventDefault();
    pendingCopy.handled = true;
  });
  doc.addEventListener('dblclick', async event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
        !event.target?.closest || event.target.closest('a, button, input, textarea, [contenteditable]')) return;
    const span = event.target.closest('.text-layer [data-markdown-item]');
    if (!span || !root.contains(span)) return;
    const layer = span.closest('.text-layer');
    if (!layer) return;
    const paragraph = paragraphAtSpan([...layer.querySelectorAll('[data-markdown-item]')], span);
    if (!paragraph || !paragraph.spans.length) return;
    const markdown = markdownToggle?.checked === true;
    const text = paragraphCopyText(paragraph.lines, markdown);
    if (!text || !selectParagraph(doc, layer, paragraph.spans)) return;
    event.preventDefault();
    pendingCopy = { text, markdown, handled: false };
    try {
      let copied = false;
      try { copied = doc.execCommand?.('copy') === true && pendingCopy.handled; } catch { /* blocked */ }
      if (!copied) await view.navigator.clipboard.writeText(text);
      view.dispatchEvent(new view.CustomEvent('pdf-viewer-toast', { detail: { message: 'Copied paragraph' } }));
    } catch {
      view.dispatchEvent(new view.CustomEvent('pdf-viewer-toast', { detail: { message: 'Could not copy paragraph' } }));
    } finally {
      pendingCopy = null;
    }
  });
}
