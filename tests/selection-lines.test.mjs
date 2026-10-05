import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionLines } from '../src/viewer/selection/selection-lines.js';

test('highlight padding expands connected lines without changing text bounds', () => {
  const rectangles = [
    { left: 10, right: 180, top: 10, bottom: 25 },
    { left: 10, right: 100, top: 30, bottom: 45 },
  ];
  const lines = selectionLines(rectangles, 2);
  assert.deepEqual(lines, [
    { left: 8, right: 182, top: 8, bottom: 29.5 },
    { left: 8, right: 102, top: 25.5, bottom: 47 },
  ]);
  assert.equal(rectangles[0].bottom, 25);
  assert.equal(rectangles[1].top, 30);
});

test('overlapping italic fragments become one band without internal bars', () => {
  assert.deepEqual(selectionLines([
    {left: 10, right: 80, top: 10, bottom: 25},
    {left: 75, right: 110, top: 9, bottom: 26},
    {left: 108, right: 180, top: 11, bottom: 25},
  ]), [{left: 10, right: 180, top: 9, bottom: 26}]);
});

test('consecutive lines join halfway through the interline gap', () => {
  const lines = selectionLines([
    {left: 10, right: 180, top: 10, bottom: 25},
    {left: 10, right: 100, top: 30, bottom: 45},
  ]);
  assert.equal(lines[0].bottom, 27.5);
  assert.equal(lines[1].top, 27.5);
});

test('paragraphs and separate columns do not acquire a connector', () => {
  const lines = selectionLines([
    {left: 10, right: 180, top: 10, bottom: 25},
    {left: 10, right: 100, top: 50, bottom: 65},
    {left: 250, right: 350, top: 70, bottom: 85},
  ]);
  assert.equal(lines[0].bottom, 25);
  assert.equal(lines[1].bottom, 65);
  assert.equal(lines[2].top, 70);
});


test('separate columns at the same baseline keep their own bands', () => {
  const lines = selectionLines([
    {left: 10, right: 100, top: 10, bottom: 25},
    {left: 250, right: 350, top: 10, bottom: 25},
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].right, 100);
  assert.equal(lines[1].left, 250);
});


test('a later italic fragment bridges all previously separate bands', () => {
  assert.deepEqual(selectionLines([
    { left: 10, right: 50, top: 10, bottom: 25 },
    { left: 90, right: 130, top: 10, bottom: 25 },
    { left: 45, right: 95, top: 11, bottom: 26 },
  ]), [{ left: 10, right: 130, top: 10, bottom: 26 }]);
});
