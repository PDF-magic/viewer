import assert from 'node:assert/strict';
import test from 'node:test';
import { trailingPunctuationOffsets, shouldIncludeTrailingPunctuation } from '../src/viewer/selection/terminal-punctuation.js';

const rect = { left: 97, right: 103, top: 30, bottom: 42, width: 6, height: 12 };
const opts = { offsets: { start: 5, end: 6 }, focusOffset: 5, forward: true, y: 35, rect };

test('recognizes final stops, questions, ellipses, closing quotes and trailing spaces', () => {
  assert.deepEqual(trailingPunctuationOffsets('Hello.'), { start: 5, end: 6 });
  assert.deepEqual(trailingPunctuationOffsets('Really?”  '), { start: 6, end: 8 });
  assert.deepEqual(trailingPunctuationOffsets('Wait...'), { start: 4, end: 7 });
  assert.deepEqual(trailingPunctuationOffsets('Yes!'), { start: 3, end: 4 });
  assert.deepEqual(trailingPunctuationOffsets('Hello'), null);
  assert.deepEqual(trailingPunctuationOffsets('Hello. Next'), null);
});

test('snaps when the pointer reaches terminal punctuation rather than passing it', () => {
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 97 }), true);
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 99 }), true);
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 95.9 }), true);
});

test('a deliberate stop before the period leaves punctuation unselected', () => {
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 95 }), false);
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 88 }), false);
});

test('does not alter reverse drags, other characters, or other lines', () => {
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 99, forward: false }), false);
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 99, focusOffset: 3 }), false);
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 99, focusOffset: 6 }), false);
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 99, y: 50 }), false);
  assert.equal(shouldIncludeTrailingPunctuation({ ...opts, x: 99, rect: { ...rect, width: 0, right: 97 } }), false);
});
