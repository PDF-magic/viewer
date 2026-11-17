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
      if (selector === '#page-count') return { addEventListener() {} };
      assert.equal(selector, '#page-number');
      return pageNumberInput;
    },
  };

  vm.runInContext(source, vm.createContext({ document }));
  assert.equal(typeof clickListener, 'function');
  clickListener();
  assert.equal(selectionCount, 1);
});


test('clicking the page count dispatches the ordinary page-change event for the final page', () => {
  const listeners = {};
  const dispatched = [];
  const input = {
    max: "17",
    value: "3",
    addEventListener(type, listener) { listeners["input:" + type] = listener; },
    dispatchEvent(event) { dispatched.push(event.type); },
  };
  const count = {
    addEventListener(type, listener) { listeners["count:" + type] = listener; },
  };
  const document = { querySelector(selector) {
    return selector === "#page-number" ? input : count;
  } };
  vm.runInContext(source, vm.createContext({ document, Event }));
  listeners["count:click"]();
  assert.equal(input.value, "17");
  assert.deepEqual(dispatched, ["change"]);
});
