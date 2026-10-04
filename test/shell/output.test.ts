import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripAnsiText, truncateText, formatCommandOutput } from '../../src/shell/index.js';

test('output: strips ANSI escape sequences', () => {
  assert.equal(stripAnsiText('\x1b[31mred\x1b[0m plain'), 'red plain');
});

test('output: short text is not truncated and has no spill file', () => {
  const r = truncateText('hello', 100);
  assert.deepEqual(r, { text: 'hello', truncated: false, spillPath: null });
});

test('output: long text is transparent — no head/tail truncation, no spill (agent layer handles it)', () => {
  const long = 'A'.repeat(400) + 'B'.repeat(400);
  const r = truncateText(long, 200);
  assert.equal(r.truncated, false);
  assert.equal(r.spillPath, null);
  assert.equal(r.text, long);
});

test('output: spill is now always disabled (transparent)', () => {
  const long = 'x'.repeat(1000);
  const r = truncateText(long, 100, { spill: false });
  assert.equal(r.truncated, false);
  assert.equal(r.spillPath, null);
  assert.equal(r.text, long);
});

test('output: empty output renders as (no output)', () => {
  const r = formatCommandOutput('', '', 1000);
  assert.equal(r.text, '(no output)');
  assert.equal(r.truncated, false);
});

test('output: strips ANSI across both streams before merging', () => {
  const r = formatCommandOutput('\x1b[32mok\x1b[0m', 'warn\x1b[33m!\x1b[0m', 1000);
  assert.equal(r.text, 'ok\nwarn!');
});
