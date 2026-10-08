import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/viewer/navigation/toolbar-layout.js', import.meta.url), 'utf8');

function fixture({ value = '900', max = '2000', pageTop = 900000, pageHeight = 700 } = {}) {
  const changeListeners = [];
  const events = [];
  const pageNumberInput = {
    value,
    max,
    addEventListener(type, callback) {
      if (type === 'change') changeListeners.push(callback);
    },
  };
  const page = {
    getBoundingClientRect() { return { top: pageTop, height: pageHeight }; },
    scrollIntoView(options) { events.push(['jump', options]); },
  };
  const viewer = {
    querySelector(selector) {
      events.push(['selector', selector]);
      return page;
    },
  };
  const searchElement = { value: '', textContent: '', addEventListener() {}, classList: { remove() {}, toggle() {} } };
  const document = {
    createElement() { return { getContext() { return { measureText() { return { width: 0 }; } }; } }; },
    querySelector(selector) {
      return selector === '#page-number' ? pageNumberInput : selector === '#viewer' ? viewer : searchElement;
    },
    documentElement: { classList: { toggle() {} } },
  };
  const media = { matches: false, addEventListener() {} };
  const window = {
    innerHeight: 900,
    scrollY: 0,
    matchMedia() { return media; },
    scrollTo(options) { events.push(['scroll', options]); },
  };
  vm.runInContext(source, vm.createContext({ document, window, MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} } }));
  return { changeListeners, events, pageNumberInput };
}

test('typed page jumps instantly before the viewer change handler', () => {
  const f = fixture();
  f.changeListeners.push(() => f.events.push(['viewer-handler']));
  for (const listener of f.changeListeners) listener();
  assert.deepEqual(f.events[0], ['selector', '.page[data-page="900"]']);
  assert.equal(f.events[1][0], 'jump');
  assert.equal(f.events[1][1].behavior, 'instant');
  assert.equal(f.events[1][1].block, 'center');
  assert.deepEqual(f.events[2], ['viewer-handler']);
});

test('typed page numbers clamp to the document bounds', () => {
  const f = fixture({ value: '9999', max: '2000' });
  f.changeListeners[0]();
  assert.deepEqual(f.events[0], ['selector', '.page[data-page="2000"]']);
});

test('tall pages jump directly to the readable top edge', () => {
  const f = fixture({ value: '1200', pageTop: 500000, pageHeight: 1400 });
  f.changeListeners[0]();
  assert.equal(f.events.at(-1)[0], 'scroll');
  assert.equal(f.events.at(-1)[1].top, 499924);
  assert.equal(f.events.at(-1)[1].behavior, 'instant');
});

test('typed jumps to page one align it with the top instead of centering it', () => {
  const f = fixture({ value: '1', pageTop: 52, pageHeight: 300 });
  f.changeListeners[0]();
  assert.equal(f.events.at(-1)[0], 'scroll');
  assert.equal(f.events.at(-1)[1].top, 0);
  assert.equal(f.events.at(-1)[1].behavior, 'instant');
  assert.ok(!f.events.some(([event]) => event === 'jump'));
});
