import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluatePolicy,
  parsePattern,
  matchRule,
  defaultTerminalPolicy,
  createSecureDefaults,
  type PolicyDecision,
  type TerminalPolicy,
} from '../../src/shell/index.js';

function makePolicy(overrides: Partial<TerminalPolicy>): TerminalPolicy {
  return { ...defaultTerminalPolicy(), ...overrides };
}

test('policy: default mode ask means unknown commands require approval', () => {
  const segments = [
    { cmd: 'npm', args: ['install'], reads: [], writes: [], hasCommandSubst: false },
  ];
  const d: PolicyDecision = evaluatePolicy(segments, defaultTerminalPolicy(), []);
  assert.equal(d.verdict, 'ask');
  assert.equal(d.requiresApproval, true);
});

test('policy: allow list grants exact command', () => {
  const policy = makePolicy({ mode: 'deny', allow: ['git status'] });
  const segments = [
    { cmd: 'git', args: ['status'], reads: [], writes: [], hasCommandSubst: false },
  ];
  const d = evaluatePolicy(segments, policy, []);
  assert.equal(d.verdict, 'allow');
});

test('policy: workspace deny beats allow', () => {
  const policy = makePolicy({ mode: 'deny', allow: ['git push --force'], deny: ['git push:*'] });
  const segments = [
    { cmd: 'git', args: ['push', '--force'], reads: [], writes: [], hasCommandSubst: false },
  ];
  const d = evaluatePolicy(segments, policy, []);
  assert.equal(d.verdict, 'deny');
  assert.equal(d.segments[0]?.match?.tier, 'workspace');
});

test('policy: hard deny beats everything, even an explicit allow', () => {
  const policy = makePolicy({ mode: 'allow', allow: ['rm -rf /'] });
  const segments = [
    { cmd: 'rm', args: ['-rf', '/'], reads: [], writes: [], hasCommandSubst: false },
  ];
  const d = evaluatePolicy(segments, policy, createSecureDefaults());
  assert.equal(d.verdict, 'deny');
  assert.equal(d.segments[0]?.match?.tier, 'hard');
});

test('policy: command substitution forces ask', () => {
  const policy = makePolicy({ mode: 'allow' });
  const segments = [{ cmd: 'cat', args: [], reads: [], writes: [], hasCommandSubst: true }];
  const d = evaluatePolicy(segments, policy, []);
  assert.equal(d.verdict, 'ask');
});

test('policy: built-in read-only commands are allowed by default', () => {
  const segments = [{ cmd: 'ls', args: ['-la'], reads: [], writes: [], hasCommandSubst: false }];
  const d = evaluatePolicy(segments, defaultTerminalPolicy(), []);
  assert.equal(d.verdict, 'allow');
  assert.equal(d.segments[0]?.match?.tier, 'readonly');
});

test('policy: worst verdict wins across chained segments', () => {
  const segments = [
    { cmd: 'echo', args: ['hi'], reads: [], writes: [], hasCommandSubst: false },
    { cmd: 'cat', args: ['file'], reads: [], writes: [], hasCommandSubst: true },
  ];
  const d = evaluatePolicy(segments, makePolicy({ mode: 'allow' }), []);
  assert.equal(d.verdict, 'ask');
});

test('rules: exact arg match requires same arg count', () => {
  const p = parsePattern('git status');
  assert.equal(matchRule(p, { cmd: 'git', args: ['status'] }), true);
  assert.equal(matchRule(p, { cmd: 'git', args: ['status', '-sb'] }), false);
});

test('rules: trailing wildcard matches any args', () => {
  const p = parsePattern('git status:*');
  assert.equal(matchRule(p, { cmd: 'git', args: ['status', '-sb'] }), true);
  assert.equal(matchRule(p, { cmd: 'git', args: [] }), false);
});

test('rules: prefix wildcard on an argument', () => {
  const p = parsePattern('chmod 777*');
  assert.equal(matchRule(p, { cmd: 'chmod', args: ['777', 'file'] }), true);
  assert.equal(matchRule(p, { cmd: 'chmod', args: ['755', 'file'] }), false);
});

test('rules: suffix wildcard on an argument', () => {
  const p = parsePattern('touch *.txt');
  assert.equal(matchRule(p, { cmd: 'touch', args: ['made.txt'] }), true);
  assert.equal(matchRule(p, { cmd: 'touch', args: ['made.log'] }), false);
});

test('rules: bare cmd matches no args only', () => {
  const p = parsePattern('pwd');
  assert.equal(matchRule(p, { cmd: 'pwd', args: [] }), true);
  assert.equal(matchRule(p, { cmd: 'pwd', args: ['-L'] }), false);
});
