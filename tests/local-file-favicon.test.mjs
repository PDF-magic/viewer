import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { localPdfFaviconUrl, updatePdfFaviconForLocalSource } from '../src/viewer/local-file-favicon.js';

function makeFavicon() {
  const attributes = { href: 'assets/luna-mark.png', type: 'image/png' };
  return {
    attributes,
    setAttribute(name, value) {
      attributes[name] = value;
    },
  };
}

test('local file PDFs use the extension-rooted sparkle favicon', () => {
  const favicon = makeFavicon();
  assert.equal(updatePdfFaviconForLocalSource('file:///Users/wynn/report.pdf', favicon), true);
  assert.deepEqual(favicon.attributes, {
    href: localPdfFaviconUrl(),
    type: 'image/svg+xml',
  });
  assert.notEqual(favicon.attributes.href, 'assets/sparkle-favicon.svg');
});

test('favicon URL resolves correctly for source and packaged extension paths', () => {
  assert.equal(
    localPdfFaviconUrl('chrome-extension://example/src/viewer/local-file-favicon.js'),
    'chrome-extension://example/src/assets/sparkle-favicon.svg',
  );
  assert.equal(
    localPdfFaviconUrl('chrome-extension://example/viewer/local-file-favicon.js'),
    'chrome-extension://example/assets/sparkle-favicon.svg',
  );
});

test('web, extension, and invalid sources keep the regular favicon', () => {
  for (const source of [
    'https://example.org/report.pdf',
    'http://localhost/file.pdf',
    'chrome-extension://abc/viewer.html',
    'blob:https://example.org/uuid',
    'not a URL',
    null,
  ]) {
    const favicon = makeFavicon();
    assert.equal(updatePdfFaviconForLocalSource(source, favicon), false);
    assert.deepEqual(favicon.attributes, {
      href: 'assets/luna-mark.png',
      type: 'image/png',
    });
  }
});

test('missing favicon element is harmless', () => {
  assert.equal(updatePdfFaviconForLocalSource('file:///tmp/report.pdf', null), false);
});

test('sparkle favicon contains vector shapes, not browser-dependent emoji text', () => {
  const svg = readFileSync(new URL('../src/assets/sparkle-favicon.svg', import.meta.url), 'utf8');
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.equal((svg.match(/<path\b/g) || []).length, 3);
  assert.doesNotMatch(svg, /<(?:text|image|use)\b/i);
});
