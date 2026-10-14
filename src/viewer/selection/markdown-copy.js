// PDF.js intentionally uses different fonts for selectable text and canvas
// rendering. Read the original font metadata, not text-layer computed styles.
export function fontTraits(font, textStyle = {}) {
  const name = [font?.name, font?.fontFamily, textStyle.fontFamily]
    .filter(value => typeof value === 'string').join(' ');
  return {
    bold: font?.bold === true || /(?:bold|black|heavy|semibold|demibold|extrabold|ultrabold)/i.test(name),
    italic: font?.italic === true || /(?:italic|oblique)/i.test(name),
  };
}

export function markPdfTextStyles(page, textContent, textDivs) {
  const textItems = textContent.items.filter(item => typeof item.str === 'string');
  const cache = new Map();
  textItems.forEach((item, index) => {
    const span = textDivs[index];
    if (!span) return;
    let traits = cache.get(item.fontName);
    if (!traits) {
      let font;
      try {
        font = page.commonObjs?.get(item.fontName);
      } catch {
        // Some PDFs lack readable font metadata; leave them as plain text.
      }
      traits = fontTraits(font, textContent.styles?.[item.fontName]);
      cache.set(item.fontName, traits);
    }
    span.dataset.markdownItem = 'true';
    if (traits.bold) span.dataset.markdownBold = 'true';
    if (traits.italic) span.dataset.markdownItalic = 'true';
    if (item.hasEOL) span.dataset.markdownEol = 'true';
  });
}

function escapeMarkdown(value) {
  return value.replace(/([\\*_\[\]])/g, '\\$1').replaceAll(String.fromCharCode(96), '\\' + String.fromCharCode(96));
}

function formatRun(run) {
  if (!run.bold && !run.italic) return escapeMarkdown(run.text);
  const leading = run.text.match(/^\s*/u)[0];
  const trailing = run.text.match(/\s*$/u)[0];
  const content = run.text.slice(leading.length, run.text.length - trailing.length);
  if (!content) return escapeMarkdown(run.text);
  const escaped = escapeMarkdown(content);
  const formatted = run.bold && run.italic ? '**_' + escaped + '_**'
    : run.bold ? '**' + escaped + '**' : '_' + escaped + '_';
  return leading + formatted + trailing;
}

// Each run describes one selected PDF.js text span. EOL and page changes are
// boundaries; adjacent fragments with identical styling are merged first.
export function markdownFromRuns(runs) {
  const parts = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    parts.push(formatRun(current));
    current = null;
  };
  for (const run of runs) {
    if (!run.text) continue;
    const separator = parts.length || current
      ? run.newPage ? '\n\n' : run.newLine ? '\n' : '' : '';
    if (separator) {
      flush();
      parts.push(separator);
    }
    if (current && current.bold === !!run.bold && current.italic === !!run.italic) {
      current.text += run.text;
    } else {
      flush();
      current = { text: run.text, bold: !!run.bold, italic: !!run.italic };
    }
  }
  flush();
  return parts.join('').trim();
}

function selectedSpanText(span, selection, doc) {
  let found = false;
  let output = '';
  const walker = doc.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      try {
        if (!range.intersectsNode(node)) continue;
        const start = range.startContainer === node ? range.startOffset : 0;
        const end = range.endContainer === node ? range.endOffset : node.textContent.length;
        if (end > start) {
          output += node.textContent.slice(start, end);
          found = true;
        }
      } catch {
        // Page rerenders may invalidate selection ranges mid-copy.
      }
    }
  }
  return found ? output : null;
}

function inPdfTextLayer(node, root) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  const layer = element?.closest?.('.text-layer');
  return !!layer && root.contains(layer);
}

export function selectionToMarkdown(root, selection, doc = document) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 ||
      !inPdfTextLayer(selection.anchorNode, root) ||
      !inPdfTextLayer(selection.focusNode, root)) return null;

  const runs = [];
  let previousPage = null;
  let previousEol = false;
  for (const span of root.querySelectorAll('.text-layer [data-markdown-item]')) {
    const text = selectedSpanText(span, selection, doc);
    if (text === null) continue;
    const page = span.closest('.page');
    if (!page) continue;
    runs.push({
      text,
      bold: span.dataset.markdownBold === 'true',
      italic: span.dataset.markdownItalic === 'true',
      newPage: previousPage !== null && previousPage !== page,
      newLine: previousEol,
    });
    previousPage = page;
    previousEol = span.dataset.markdownEol === 'true';
  }
  return runs.length ? markdownFromRuns(runs) : null;
}

export function installMarkdownCopy(root, toggle, doc = document) {
  if (!root || !toggle) return;
  doc.addEventListener('copy', event => {
    if (!toggle.checked || !event.clipboardData) return;
    const markdown = selectionToMarkdown(root, doc.getSelection(), doc);
    if (!markdown) return; // Never interfere with native copying otherwise.
    event.clipboardData.setData('text/plain', markdown);
    event.clipboardData.setData('text/markdown', markdown);
    event.preventDefault();
  });
}
