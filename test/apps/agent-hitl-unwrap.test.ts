import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hitlToolSchema } from '../../apps/agent/tools/hitl.js';

const OPTS = [
  { id: 'hooks-only', title: 'Hooks only' },
  { id: 'hooks-and-memo', title: 'Hooks + memo' },
];

function parseChoice(input: unknown) {
  return hitlToolSchema.safeParse({
    kind: 'choice',
    title: 'Scope of the Object.is fix',
    ...(input as Record<string, unknown>),
  });
}

test('hitl unwrap: bare array still passes', () => {
  const r = parseChoice({ options: OPTS });
  assert.equal(r.success, true);
});

test('hitl unwrap: single-wrapped {item:[...]} passes (msg-opvRbDFIMqyX8u8o attempts 1,2,5)', () => {
  const r = parseChoice({ options: { item: OPTS } });
  assert.equal(r.success, true);
  if (r.success && r.data.kind === 'choice') {
    assert.equal(r.data.options.length, 2);
  }
});

test('hitl unwrap: double-wrapped {item:{item:[...]}} passes (attempt 3)', () => {
  const r = parseChoice({ options: { item: { item: OPTS } } });
  assert.equal(r.success, true);
});

test('hitl unwrap: wrapped string shorthands pass (attempt 4)', () => {
  const r = parseChoice({ options: { item: ['Yes', 'No'] } });
  assert.equal(r.success, true);
});

test('hitl unwrap: non-array wrappers still fail', () => {
  assert.equal(parseChoice({ options: { item: 'not-an-array' } }).success, false);
  assert.equal(parseChoice({ options: { foo: OPTS } }).success, false);
  assert.equal(parseChoice({ options: { item: [] } }).success, false);
  assert.equal(parseChoice({ options: [] }).success, false);
});

test('hitl unwrap: defaultSelection wrapper also unwraps', () => {
  const r = parseChoice({ options: OPTS, defaultSelection: { item: ['hooks-only'] } });
  assert.equal(r.success, true);
});

test('hitl coerce: string booleans and numeric strings pass (real model shapes)', () => {
  const r = parseChoice({
    options: {
      item: [
        { id: 'hooks-only', title: 'Hooks only', recommended: 'true' },
        { id: 'hooks-and-memo', title: 'Hooks + memo', recommended: 'false' },
      ],
    },
    timeoutMs: '600000',
  });
  assert.equal(r.success, true);
  if (r.success && r.data.kind === 'choice') {
    assert.equal(r.data.timeoutMs, 600000);
  }
});

test('hitl coerce: garbage strings still fail', () => {
  assert.equal(parseChoice({ options: OPTS, timeoutMs: 'soon' }).success, false);
  assert.equal(
    parseChoice({
      options: [{ id: 'a', title: 'A', recommended: 'maybe' }],
    }).success,
    false,
  );
});
