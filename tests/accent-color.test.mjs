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

const selectionStyles = readFileSync(new URL('../src/viewer/selection/text-selection.css', import.meta.url), 'utf8');
const viewerStyles = readFileSync(new URL('../src/viewer/viewer.css', import.meta.url), 'utf8');

test('selected text and highlight outlines follow the theme color', () => {
  assert.match(accentStyles, /--selection-bg:\s*color-mix\(in srgb, var\(--accent\) 45%, transparent\)/);
  assert.match(accentStyles, /--highlight-outline:\s*color-mix\(in srgb, var\(--accent\) 95%, transparent\)/);
  assert.match(selectionStyles, /\.text-selection-overlay > svg\s*\{[^}]*stroke:\s*var\(--accent\)/);
  assert.match(viewerStyles, /\.text-layer ::selection\s*\{[^}]*background:\s*var\(--selection-bg\)/);
  assert.match(viewerStyles, /\.highlight-region-outline\s*\{[^}]*stroke:\s*var\(--highlight-outline\)/);
});
