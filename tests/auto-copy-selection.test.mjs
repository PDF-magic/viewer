import assert from 'node:assert/strict';
import test from 'node:test';
import { installMarkdownCopy } from '../src/viewer/selection/markdown-copy.js';

function setup({ execResult = true } = {}) {
  const handlers = new Map();
  const layer = {
    nodeType: 1,
    closest(selector) { return selector === '.text-layer' ? layer : null; },
  };
  const text = { nodeType: 3, parentElement: layer };
  const selection = {
    isCollapsed: false, rangeCount: 1, anchorNode: text, focusNode: text,
    toString: () => 'agents',
  };
  const clipboardWrites = [];
  const windowListeners = new Map();
  const win = {
    addEventListener(name, fn) { windowListeners.set(name, fn); },
    navigator: { clipboard: { async writeText(value) { clipboardWrites.push(value); } } },
  };
  let copyCalls = 0;
  const doc = {
    defaultView: win,
    getSelection: () => selection,
    addEventListener(name, fn) { handlers.set(name, fn); },
    execCommand(command) {
      assert.equal(command, 'copy');
      copyCalls += 1;
      return execResult;
    },
  };
  const root = {
    contains(candidate) { return candidate === layer; },
    querySelectorAll: () => [],
  };
  const markdown = { checked: false };
  const paragraphs = { checked: true };
  const auto = { checked: false };
  installMarkdownCopy(root, markdown, doc, paragraphs, auto);
  const gesture = (target = text, button = 0) => {
    handlers.get('pointerdown')({ target, button });
    handlers.get('pointerup')({});
  };
  return {
    gesture, handlers, selection, text, win, windowListeners, auto,
    clipboardWrites, get copyCalls() { return copyCalls; },
  };
}

test('copy-on-select is opt-in and only copies nonempty PDF text selections', async () => {
  const state = setup();
  state.gesture();
  await Promise.resolve();
  assert.equal(state.copyCalls, 0);

  state.auto.checked = true;
  state.gesture({});
  state.gesture(state.text, 2);
  await Promise.resolve();
  assert.equal(state.copyCalls, 0);

  state.gesture();
  await Promise.resolve();
  assert.equal(state.copyCalls, 1);
  assert.equal(state.selection.toString(), 'agents');
  assert.equal(state.selection.isCollapsed, false);

  state.selection.isCollapsed = true;
  state.gesture();
  await Promise.resolve();
  assert.equal(state.copyCalls, 1);

  state.selection.isCollapsed = false;
  state.selection.focusNode = {};
  state.gesture();
  await Promise.resolve();
  assert.equal(state.copyCalls, 1);
});

test('canceled pointer gestures and window blur cannot copy old selections', async () => {
  const state = setup();
  state.auto.checked = true;
  state.handlers.get('pointerdown')({ target: state.text, button: 0 });
  state.handlers.get('pointercancel')({});
  state.handlers.get('pointerup')({});
  await Promise.resolve();
  assert.equal(state.copyCalls, 0);
  state.handlers.get('pointerdown')({ target: state.text, button: 0 });
  state.windowListeners.get('blur')();
  state.handlers.get('pointerup')({});
  await Promise.resolve();
  assert.equal(state.copyCalls, 0);
});

test('falls back to writing native plain text if a copy command is denied', async () => {
  const state = setup({ execResult: false });
  state.auto.checked = true;
  state.gesture();
  await Promise.resolve();
  assert.equal(state.copyCalls, 1);
  assert.deepEqual(state.clipboardWrites, ['agents']);
});
