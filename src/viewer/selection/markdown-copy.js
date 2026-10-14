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

// PDF.js discards marked-content /ActualText from getTextContent(), but its
// structure tree exposes paragraph roles and MCIDs. The enhancer emits one
// marked-content group per logical paragraph, including the original line runs.
export function structureContentOrder(tree) {
  const ordered = new Map();
  let blockNumber = 0;
  let leafNumber = 0;
  const walk = (node, block = null) => {
    if (!node) return;
    if (node.type === 'content') {
      if (typeof node.id === 'string' && !ordered.has(node.id)) {
        ordered.set(node.id, { order: leafNumber++, block: block?.number ?? null, role: block?.role ?? null });
      }
      return;
    }
    // A new semantic block, not a typographical line, is a paragraph break.
    const isBlock = /^(?:P|H[1-6]|L|LI|LBody|BlockQuote|Caption)$/.test(node.role || '');
    const nextBlock = isBlock ? { number: blockNumber++, role: node.role } : block;
    for (const child of node.children || []) walk(child, nextBlock);
  };
  walk(tree);
  return ordered;
}

export function markPdfTextStructure(textLayer, tree) {
  const order = structureContentOrder(tree);
  // PDF.js text layers give marked spans the same p<page>_mc<index> ids
  // present in getStructTree()'s content leaf nodes.
  for (const wrapper of textLayer.querySelectorAll('.markedContent[id]')) {
    const content = order.get(wrapper.id);
    if (!content) continue;
    for (const span of wrapper.querySelectorAll('[data-markdown-item]')) {
      span.dataset.copyOrder = String(content.order);
      if (content.block !== null) span.dataset.copyBlock = String(content.block);
      if (content.role) span.dataset.copyRole = content.role;
    }
  }
  return order.size;
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

// A PDF line is not necessarily a paragraph. Tagged P content identifies
// where PDF.js line breaks can be replaced with spaces without guessing.
export function markdownFromRuns(runs, { markdown = true, reflow = true } = {}) {
  const parts = [];
  let current = null;
  let previous = null;
  const flush = () => {
    if (!current) return;
    parts.push(markdown ? formatRun(current) : current.text);
    current = null;
  };
  for (const run of runs) {
    if (!run.text) continue;
    let separator = '';
    if (previous) {
      if (run.newPage || (reflow && run.block !== null && run.block !== undefined &&
          previous.block !== null && previous.block !== undefined && run.block !== previous.block)) {
        separator = '\n\n';
      } else if (run.newLine) {
        separator = reflow && run.role === 'P' && previous.role === 'P' &&
          run.block !== null && run.block === previous.block ? ' ' : '\n';
      }
    }
    if (separator === ' ') {
      // Keep a single Markdown emphasis span across soft line wraps.
      const adjacentSpace = /\s$/.test(current?.text ?? parts.at(-1) ?? '') || /^\s/.test(run.text);
      if (current && current.bold === !!run.bold && current.italic === !!run.italic) {
        if (!adjacentSpace) current.text += ' ';
      } else {
        flush();
        if (!adjacentSpace) parts.push(' ');
      }
    } else if (separator) {
      flush();
      parts.push(separator);
    }
    if (current && current.bold === !!run.bold && current.italic === !!run.italic) {
      current.text += run.text;
    } else {
      flush();
      current = { text: run.text, bold: !!run.bold, italic: !!run.italic };
    }
    previous = run;
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

export function selectionToMarkdown(root, selection, doc = document,
    { markdown = true, reflow = true } = {}) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 ||
      !inPdfTextLayer(selection.anchorNode, root) ||
      !inPdfTextLayer(selection.focusNode, root)) return null;

  const selected = [];
  for (const span of root.querySelectorAll('.text-layer [data-markdown-item]')) {
    const text = selectedSpanText(span, selection, doc);
    if (text === null) continue;
    const page = span.closest('.page');
    if (!page) continue;
    selected.push({
      text,
      bold: span.dataset.markdownBold === 'true',
      italic: span.dataset.markdownItalic === 'true',
      page,
      eol: span.dataset.markdownEol === 'true',
      block: span.dataset.copyBlock === undefined ? null : span.dataset.copyBlock,
      role: span.dataset.copyRole ?? null,
      order: span.dataset.copyOrder === undefined ? null : Number(span.dataset.copyOrder),
    });
  }
  if (!selected.length) return null;
  // Never reorder a selection containing untagged text: the tree cannot tell
  // us how those fragments should be interleaved with tagged content.
  if (selected.every(run => run.order !== null && Number.isFinite(run.order))) {
    selected.sort((a, b) => a.order - b.order);
  }
  let previous = null;
  let structuredParagraph = false;
  const runs = selected.map(run => {
    const result = {
      ...run,
      newPage: previous !== null && run.page !== previous.page,
      newLine: previous?.eol === true,
    };
    if (run.role === 'P') structuredParagraph = true;
    previous = run;
    return result;
  });
  // Without Markdown, only take over copy for semantic paragraphs. Otherwise
  // preserve the browser's native plain-text behavior for untagged PDFs.
  if (!markdown && !structuredParagraph) return null;
  return markdownFromRuns(runs, { markdown, reflow });
}

export function installMarkdownCopy(root, markdownToggle, doc = document, paragraphToggle = null) {
  if (!root || !markdownToggle) return;
  doc.addEventListener('copy', event => {
    if (!event.clipboardData) return;
    const markdown = markdownToggle.checked;
    const reflow = paragraphToggle?.checked !== false;
    if (!markdown && !reflow) return;
    const copied = selectionToMarkdown(root, doc.getSelection(), doc, { markdown, reflow });
    if (!copied) return;
    event.clipboardData.setData('text/plain', copied);
    if (markdown) event.clipboardData.setData('text/markdown', copied);
    event.preventDefault();
  });
}
