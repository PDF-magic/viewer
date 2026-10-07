import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const minimap = readFileSync(new URL('../src/viewer/navigation/minimap.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/viewer/viewer-settings.js', import.meta.url), 'utf8');
const minimapStyles = readFileSync(new URL('../src/viewer/navigation/minimap.css', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../src/viewer/viewer.js', import.meta.url), 'utf8');
const capture = minimap.match(/function updateMinimapLayout\(update\) \{[\s\S]*?\n\}/)[0];
const listener = settings.match(/window.addEventListener\("pdf-viewer-minimap-layout-change", \(event\) => \{[\s\S]*?\n  \}\);/)[0];

test('minimap layout preserves the reading point synchronously through repeated size changes', () => {
  for (const ratio of [0.1, 0.5, 0.9]) {
    let height = 1400;
    const window = {
      innerHeight: 900, scrollY: 76 + 40 * height + ratio * height - 450, scrollX: 0,
      addEventListener(type, callback) { this.callback = callback; },
      dispatchEvent(event) { this.callback(event); },
      scrollTo({ top, behavior }) { assert.equal(behavior, 'instant'); this.scrollY = top; },
    };
    const pages = Array.from({ length: 100 }, (_, index) => ({
      getBoundingClientRect: () => ({ top: 76 + index * height - window.scrollY, height }),
    }));
    let renders = 0;
    const context = vm.createContext({
      window, viewer: { querySelectorAll: () => pages },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
      applyZoomLayout() {}, syncZoomControls() {}, scheduleViewerRerender() { renders++; },
    });
    vm.runInContext(`${capture}\n${listener}`, context);
    for (const nextHeight of [1260, 1400, 1260, 1400]) {
      context.update = () => { height = nextHeight; };
      vm.runInContext('updateMinimapLayout(update)', context);
      const rect = pages[40].getBoundingClientRect();
      assert.ok(Math.abs(rect.top + rect.height * ratio - 450) < 0.00001);
    }
    assert.equal(renders, 4);
  }
});

test('collapsed minimap fit-width accounts for the browser scrollbar and outline gutters', () => {
  const viewportWidth = settings.match(/function viewportPageWidth\(\) \{[\s\S]*?\n\}/)[0];
  const classes = new Set(['minimap-collapsed']);
  const context = vm.createContext({
    PAGE_HORIZONTAL_GUTTER: 32,
    window: { innerWidth: 1200 },
    document: {
      documentElement: {
        clientWidth: 1185,
        classList: {
          contains(value) { return classes.has(value); },
        },
      },
      querySelector() {
        return { getBoundingClientRect: () => ({ width: 96 }) };
      },
    },
  });

  vm.runInContext(viewportWidth, context);
  assert.equal(vm.runInContext('viewportPageWidth()', context), 1183);
  assert.equal(vm.runInContext('viewportPageWidth()', context) + 2, context.document.documentElement.clientWidth);

  classes.add('minimap-left');
  assert.equal(vm.runInContext('viewportPageWidth()', context), 1183);
  context.document.documentElement.clientWidth = 1200;
  assert.equal(vm.runInContext('viewportPageWidth()', context), 1198);

  classes.add('minimap-disabled');
  assert.equal(vm.runInContext('viewportPageWidth()', context), 1168);
  assert.match(
    minimapStyles,
    /html\.minimap-collapsed:not\(\.minimap-disabled\) \.viewer\[data-zoom-mode\]\s*\{[\s\S]*?padding-right:\s*1px;[\s\S]*?padding-left:\s*1px;/,
  );
});

test('zoom refresh renders without rotation or page recentering', () => {
  const refresh = viewer.match(/async function refreshPageRendering\(\) \{[\s\S]*?\n\}/)[0];
  const force = settings.match(/function forceViewerRerender\(\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(refresh, /scrollIntoView|scrollTo|rotation =/);
  assert.match(refresh, /queuePageRender\(currentPage, true\)/);
  assert.match(force, /pdf-viewer-rerender/);
  assert.doesNotMatch(force, /\.click\(/);
  assert.doesNotMatch(minimap, /new Event\("resize"\)/);
});
