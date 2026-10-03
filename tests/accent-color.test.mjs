import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const accentSource = readFileSync(new URL('../src/viewer/theme/accent-color.js', import.meta.url), 'utf8');
const accentStyles = readFileSync(new URL('../src/viewer/theme/accent-color.css', import.meta.url), 'utf8');
const imageToggleSource = readFileSync(new URL('../src/viewer/theme/image-color-toggle.js', import.meta.url), 'utf8');

test('theme color control is loaded with the existing theme module', () => {
  assert.match(imageToggleSource, /import "\.\/accent-color\.js";/);
  assert.match(accentSource, /text\.textContent = "Theme color";/);
  assert.match(accentSource, /accentColorInput\.type = "color";/);
});

test('theme color persists globally and keeps Studio green as the default', () => {
  assert.match(accentSource, /pdf-viewer-accent-color/);
  assert.match(accentSource, /DEFAULT_ACCENT_COLOR = "#43af49"/);
  assert.match(accentSource, /chrome\.storage\.local\.get/);
  assert.match(accentSource, /chrome\.storage\.local\.set/);
  assert.match(accentSource, /chrome\.storage\.onChanged\.addListener/);
});

test('accent variable drives the viewer green treatment', () => {
  assert.match(accentStyles, /--accent:\s*#43af49/);
  assert.match(accentStyles, /--page-border:\s*var\(--accent\)/);
  assert.match(accentStyles, /--minimap-accent:\s*var\(--accent\)/);
  assert.match(accentStyles, /search-highlight[\s\S]*?var\(--accent\)/);
  assert.match(accentStyles, /accent-color:\s*var\(--accent\)\s*!important/);
});
