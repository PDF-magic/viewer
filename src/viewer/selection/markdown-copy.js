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

// PDF.js separates font/style runs into positioned text spans. An actual word
// space can therefore be visible on the page without existing in either span.
// Infer it only from a clear inline gap on the same baseline, not merely from
// a change in italic or bold styling (which can occur inside words).
export function hasPdfWordGap(previous, current) {
  if (!previous || previous.hasEOL || !previous.str || !current.str ||
      /\s$/u.test(previous.str) || /^\s/u.test(current.str) ||
      previous.dir === 'rtl' || current.dir === 'rtl') return false;
  const from = previous.transform;
  const to = current.transform;
  if (!Array.isArray(from) || from.length < 6 ||
      !Array.isArray(to) || to.length < 6 ||
      !(previous.width > 0) || !(current.width > 0)) return false;
  const fromLength = Math.hypot(from[0], from[1]);
  const toLength = Math.hypot(to[0], to[1]);
  if (!(fromLength > 0 && toLength > 0)) return false;
  const ux = from[0] / fromLength;
  const uy = from[1] / fromLength;
  if ((from[0] * to[0] + from[1] * to[1]) / (fromLength * toLength) < 0.98) return false;
  const dx = to[4] - from[4];
  const dy = to[5] - from[5];
  const fontHeight = Math.min(previous.height || fromLength, current.height || toLength);
  if (!(fontHeight > 0) || Math.abs(dx * -uy + dy * ux) > fontHeight * 0.2) return false;
  const projectedGap = dx * ux + dy * uy - previous.width;
  const characterWidth = Math.min(
    previous.width / Array.from(previous.str).length,
    current.width / Array.from(current.str).length,
  );
  return projectedGap > Math.max(0.8, fontHeight * 0.12, characterWidth * 0.35);
}

export function markPdfTextStyles(page, textContent, textDivs) {
  const textItems = textContent.items.filter(item => typeof item.str === 'string');
  const viewport = page.getViewport?.({ scale: 1 });
  const heights = textItems.map(item => Math.abs(item.height || 0)).filter(height => height > 0)
    .sort((a, b) => a - b);
  const typicalHeight = heights[Math.floor(heights.length / 2)] || 0;
  const leftMargin = Math.min(...textItems.filter(item =>
    item.transform?.length >= 6 && item.height >= typicalHeight * 0.85 &&
    (!viewport || item.transform[4] < viewport.width * 0.4))
    .map(item => item.transform[4]));
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
    if (viewport && item.transform?.length >= 6) {
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      span.dataset.markdownXRatio = String(x / viewport.width);
      span.dataset.markdownYRatio = String(y / viewport.height);
      const previousBody = textItems.slice(0, index).reverse().find(candidate =>
        candidate.str.trim() && candidate.height >= typicalHeight * 0.85 &&
        candidate.transform?.length >= 6);
      if (previousBody) {
        const baselineDifference = previousBody.transform[5] - item.transform[5];
        const indent = item.transform[4] - leftMargin;
        if (baselineDifference > typicalHeight * 1.4 &&
            indent > typicalHeight * 2.5 && indent < typicalHeight * 5.5 &&
            item.height >= typicalHeight * 0.85) {
          span.dataset.markdownParagraphStart = 'true';
        }
        const superscriptRise = item.transform[5] - previousBody.transform[5];
        const precedingRight = previousBody.transform[4] + (previousBody.width || 0);
        if (item.height > 0 && item.height < typicalHeight * 0.83 &&
            /^[\dlI|]{1,3}$/.test(item.str.trim()) &&
            superscriptRise > typicalHeight * 0.2 && superscriptRise < typicalHeight &&
            Math.abs(item.transform[4] - precedingRight) < typicalHeight) {
          span.dataset.markdownSuperscript = 'true';
        }
      }
    }
    const previousText = textItems.slice(0, index).reverse().find(candidate =>
      candidate.str.trim() && candidate.transform?.length >= 6);
    const wrappedLine = previousText && item.transform?.length >= 6 &&
      previousText.transform[5] - item.transform[5] > typicalHeight * 1.3 &&
      previousText.transform[5] - item.transform[5] < typicalHeight * 3.5 &&
      !span.dataset.markdownParagraphStart && !/[-\s]$/.test(previousText.str) &&
      !/^\s/.test(item.str);
    if (hasPdfWordGap(textItems[index - 1], item) || wrappedLine) {
      span.dataset.markdownSpaceBefore = 'true';
    }
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
    if (markdown && run.footnoteReference) {
      if (current) current.text = current.text.replace(/\s+$/, '');
      flush();
      // Trailing PDF spaces may be isolated in a differently styled text run.
      while (parts.length) {
        const trimmed = parts.at(-1).replace(/\s+$/, '');
        if (trimmed) {
          parts[parts.length - 1] = trimmed;
          break;
        }
        parts.pop();
      }
      parts.push('[^' + run.footnoteReference + ']');
      previous = run;
      continue;
    }
    let separator = '';
    if (previous) {
      if (run.newPage || run.newParagraph || (reflow && run.block !== null && run.block !== undefined &&
          previous.block !== null && previous.block !== undefined && run.block !== previous.block)) {
        separator = '\n\n';
      } else if (run.newLine) {
        separator = reflow && run.role === 'P' && previous.role === 'P' &&
          run.block !== null && run.block === previous.block ? ' ' : '\n';
      }
    }
    if (!separator && previous && run.spaceBefore) separator = ' ';
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

function footnoteAtPosition(run, footnotes) {
  if (!Number.isInteger(run.pageNumber) || !Number.isFinite(run.xRatio) ||
      !Number.isFinite(run.yRatio)) return null;
  return footnotes.find(note => note.pageNumber === run.pageNumber &&
    note.highlightRegions?.some(region => region.pageNumber === run.pageNumber &&
      run.xRatio >= region.left - 0.003 &&
      run.xRatio <= region.left + region.width + 0.003 &&
      run.yRatio >= region.top - 0.003 &&
      run.yRatio <= region.top + region.height + 0.003)) || null;
}

export function selectionToMarkdown(root, selection, doc = document,
    { markdown = true, reflow = true, footnotes = [] } = {}) {
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
      spaceBefore: span.dataset.markdownSpaceBefore === 'true',
      page,
      pageNumber: Number(page.dataset?.page) || null,
      xRatio: Number(span.dataset.markdownXRatio),
      yRatio: Number(span.dataset.markdownYRatio),
      superscript: span.dataset.markdownSuperscript === 'true',
      paragraphStart: span.dataset.markdownParagraphStart === 'true',
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
  const selectedNotes = new Set();
  const body = markdown ? selected.filter(run => {
    const note = footnoteAtPosition(run, footnotes);
    if (!note) return true;
    selectedNotes.add(note);
    return false;
  }) : selected;
  let previous = null;
  let structuredParagraph = false;
  const runs = body.map(run => {
    const reference = markdown && run.superscript ? footnotes.find(note =>
      note.pageNumber === run.pageNumber &&
      String(note.number) === run.text.trim().replace(/[lI|]/g, '1')) : null;
    const result = {
      ...run,
      newPage: previous !== null && run.page !== previous.page,
      newParagraph: previous !== null && run.page === previous.page &&
        run.paragraphStart && run.block === null,
      footnoteReference: reference?.number,
      newLine: previous?.eol === true,
    };
    if (run.role === 'P') structuredParagraph = true;
    previous = run;
    return result;
  });
  // Without Markdown, only take over copy for semantic paragraphs. Otherwise
  // preserve the browser's native plain-text behavior for untagged PDFs.
  if (!markdown && !structuredParagraph) return null;
  const content = markdownFromRuns(runs, { markdown, reflow });
  if (!markdown || !selectedNotes.size) return content;
  // Use the already-recovered footnote index text. In older OCR PDFs the
  // printed numeric label may be read as punctuation or omitted altogether.
  const definitions = [...selectedNotes].map(note =>
    '[^' + note.number + ']: ' + escapeMarkdown(note.text.trim()));
  return [content, ...definitions].filter(Boolean).join('\n\n');
}

export function installMarkdownCopy(root, markdownToggle, doc = document, paragraphToggle = null) {
  if (!root || !markdownToggle) return;
  let indexedFootnotes = [];
  doc.defaultView?.addEventListener('pdf-viewer-footnotes-indexed', event => {
    if (Array.isArray(event.detail)) indexedFootnotes = event.detail;
  });
  doc.addEventListener('copy', event => {
    if (!event.clipboardData) return;
    const markdown = markdownToggle.checked;
    const reflow = paragraphToggle?.checked !== false;
    if (!markdown && !reflow) return;
    const copied = selectionToMarkdown(root, doc.getSelection(), doc, { markdown, reflow, footnotes: indexedFootnotes });
    if (!copied) return;
    event.clipboardData.setData('text/plain', copied);
    if (markdown) event.clipboardData.setData('text/markdown', copied);
    event.preventDefault();
  });
}
