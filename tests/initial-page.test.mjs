import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const viewerSource = readFileSync(new URL('../src/viewer/viewer.js', import.meta.url), 'utf8');
const getInitialPageSource = viewerSource.match(
  /function getInitialPage\(\.\.\.urls\) \{[\s\S]*?\n\}/,
)?.[0];

assert.ok(getInitialPageSource, 'getInitialPage function should be present');

function initialPage(...hashes) {
  const context = vm.createContext({ urls: hashes.map(hash => ({ hash })) });
  vm.runInContext(`${getInitialPageSource}; result = getInitialPage(...urls);`, context, {
    filename: 'viewer.js',
  });
  return context.result;
}

test('viewer hash takes precedence over the source URL hash', () => {
  assert.equal(initialPage('#page=14', '#page=3'), 14);
});

test('source URL hash remains the fallback for shared PDF links', () => {
  assert.equal(initialPage('', '#page=7'), 7);
});

test('missing and invalid page hashes start at page one', () => {
  assert.equal(initialPage('', '#section=introduction'), 1);
  assert.equal(initialPage('#page=0'), 1);
});
