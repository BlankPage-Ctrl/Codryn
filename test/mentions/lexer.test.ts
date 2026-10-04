import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectPrefixAt, tokenize } from '../../src/mentions/engines/lexer.js';

test('tokenize: participant + command + reference + text', () => {
  const tokens = tokenize('@workspace /explain #file:src/utils.ts refactor this');

  assert.deepEqual(tokens, [
    {
      type: 'PARTICIPANT',
      name: 'workspace',
      range: { start: 0, end: 10 },
      raw: '@workspace',
    },
    {
      type: 'COMMAND',
      name: 'explain',
      range: { start: 11, end: 19 },
      raw: '/explain',
    },
    {
      type: 'TEXT',
      value: ' ',
      range: { start: 19, end: 20 },
      raw: ' ',
    },
    {
      type: 'REFERENCE',
      kind: 'file',
      args: 'src/utils.ts',
      range: { start: 20, end: 38 },
      raw: '#file:src/utils.ts',
    },
    {
      type: 'TEXT',
      value: ' refactor this',
      range: { start: 38, end: 52 },
      raw: ' refactor this',
    },
  ]);
});

test('tokenize: reference can appear mid-text', () => {
  const tokens = tokenize('explain #file:a.ts please');
  assert.deepEqual(
    tokens.map((t) => t.type),
    ['TEXT', 'REFERENCE', 'TEXT'],
  );
  assert.equal(tokens[0].type === 'TEXT' ? tokens[0].value : '', 'explain ');
  assert.equal(tokens[2].type === 'TEXT' ? tokens[2].value : '', ' please');
});

test('tokenize: @ mid-text stays text', () => {
  const tokens = tokenize('what is @this');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, 'TEXT');
  assert.equal(tokens[0].type === 'TEXT' ? tokens[0].value : '', 'what is @this');
});

test('tokenize: lone @ without name stays text', () => {
  const tokens = tokenize('@ ');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, 'TEXT');
});

test('tokenize: # without kind stays text', () => {
  const tokens = tokenize('use # in text');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, 'TEXT');
});

test('tokenize: command without participant', () => {
  const tokens = tokenize('/explain refactor');
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].type, 'COMMAND');
  assert.equal(tokens[0].type === 'COMMAND' ? tokens[0].name : '', 'explain');
  assert.equal(tokens[1].type, 'TEXT');
});

test('tokenize: leading whitespace is skipped', () => {
  const tokens = tokenize('  @workspace /fix do it');
  assert.equal(tokens[0].type, 'PARTICIPANT');
  assert.deepEqual(tokens[0].range, { start: 2, end: 12 });
  assert.equal(tokens[1].type, 'COMMAND');
  assert.equal(tokens[2].type, 'TEXT');
});

test('tokenize: reference without args', () => {
  const tokens = tokenize('#selection explain');
  assert.equal(tokens[0].type, 'REFERENCE');
  assert.deepEqual(tokens[0].type === 'REFERENCE' ? tokens[0].args : null, '');
});

test('tokenize: multiple references', () => {
  const tokens = tokenize('#file:a.ts and #file:b.ts');
  const refs = tokens.filter((t) => t.type === 'REFERENCE');
  assert.equal(refs.length, 2);
});

test('detectPrefixAt: finds # trigger with prefix', () => {
  const hit = detectPrefixAt('read #fi', 8);
  assert.deepEqual(hit, { kind: '#', prefix: 'fi', start: 5 });
});

test('detectPrefixAt: empty prefix right after trigger', () => {
  const hit = detectPrefixAt('@workspace @', 12);
  assert.deepEqual(hit, { kind: '@', prefix: '', start: 11 });
});

test('detectPrefixAt: no trigger returns null', () => {
  assert.equal(detectPrefixAt('hello world', 5), null);
});
