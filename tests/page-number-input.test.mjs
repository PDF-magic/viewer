import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../src/viewer/navigation/page-number-input.js', import.meta.url),
  'utf8',
);

test('clicking the page-number field selects its full value', () => {
  let clickListener;
  let selectionCount = 0;
  const pageNumberInput = {
    addEventListener(type, listener) {
      if (type === 'click') clickListener = listener;
    },
    select() {
      selectionCount += 1;
    },
  };
  const document = {
    querySelector(selector) {
      assert.equal(selector, '#page-number');
      return pageNumberInput;
    },
  };

  vm.runInContext(source, vm.createContext({ document }));
  assert.equal(typeof clickListener, 'function');
  clickListener();
  assert.equal(selectionCount, 1);
});
