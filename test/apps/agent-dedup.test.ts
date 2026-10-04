import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadSubsetGuard, createRepeatGuard } from '../../apps/agent/utils/dedup.js';

test('subset guard: fully covered window is refused', () => {
  const guard = createReadSubsetGuard();
  assert.equal(guard.check('a.ts', 1, 130), null);
  guard.record('a.ts', 1, 130, true);
  const refused = guard.check('a.ts', 90, 120);
  assert.ok(refused?.includes('ALREADY_READ'));
  const inner = guard.check('a.ts', 100, 110);
  assert.ok(inner?.includes('ALREADY_READ'));
  // Partial overlap with new ground passes.
  assert.equal(guard.check('a.ts', 90, 180), null);
});

test('subset guard: continuation with new ground passes', () => {
  const guard = createReadSubsetGuard();
  assert.equal(guard.check('a.ts', 1, 130), null);
  guard.record('a.ts', 1, 130, true);
  assert.equal(guard.check('a.ts', 131, 260), null);
  guard.record('a.ts', 131, 260, true);
  // Union of adjacent windows covers 1-260.
  assert.ok(guard.check('a.ts', 50, 200)?.includes('ALREADY_READ'));
});

test('subset guard: truncated prior read does not protect', () => {
  const guard = createReadSubsetGuard();
  assert.equal(guard.check('a.ts', 1, undefined), null);
  guard.record('a.ts', 1, undefined, false);
  assert.equal(guard.check('a.ts', 1, 130), null);
});

test('subset guard: spill paths are always refused', () => {
  const guard = createReadSubsetGuard();
  assert.ok(guard.check('.codryn/truncated/grep-abcde.txt', 1, 50)?.includes('SPILL_FILE'));
  assert.ok(
    guard.check('./.codryn/truncated/read_file-x.txt', 1, undefined)?.includes('SPILL_FILE'),
  );
  // Other dot-paths still pass.
  assert.equal(guard.check('.codryn/plan/chat-1.md', 1, 10), null);
});

test('subset guard: open-ended first read covers later windows', () => {
  const guard = createReadSubsetGuard();
  assert.equal(guard.check('a.ts', 1, undefined), null);
  guard.record('a.ts', 1, undefined, true);
  assert.ok(guard.check('a.ts', 500, 600)?.includes('ALREADY_READ'));
});

test('repeat guard: third identical call is refused, then resets', () => {
  const guard = createRepeatGuard();
  const input = JSON.stringify({ pattern: 'x', path: '.' });
  assert.equal(guard.check(input, 'grep'), null);
  assert.equal(guard.check(input, 'grep'), null);
  const refused = guard.check(input, 'grep');
  assert.ok(refused?.includes('REPEAT_CALL'));
  // After refusal the streak resets.
  assert.equal(guard.check(input, 'grep'), null);
});

test('repeat guard: differing input breaks the streak', () => {
  const guard = createRepeatGuard();
  const a = JSON.stringify({ pattern: 'x' });
  const b = JSON.stringify({ pattern: 'y' });
  assert.equal(guard.check(a, 'grep'), null);
  assert.equal(guard.check(a, 'grep'), null);
  assert.equal(guard.check(b, 'grep'), null);
  assert.equal(guard.check(a, 'grep'), null);
});
