import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseShell } from '../../src/shell/index.js';

test('parser: splits chained commands into independent segments', () => {
  const r = parseShell('ls && rm -rf /');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(
    r.segments.map((s) => s.cmd),
    ['ls', 'rm'],
  );
  assert.deepEqual(r.segments[1]?.args, ['-rf', '/']);
});

test('parser: strips quotes like bash', () => {
  const r = parseShell(`echo "hello world" 'single'`);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.cmd, 'echo');
  assert.deepEqual(r.segments[0]?.args, ['hello world', 'single']);
});

test('parser: flags command substitution ($() and backticks)', () => {
  assert.equal(parseShell('cat $(ls)')?.segments[0]?.hasCommandSubst, true);
  assert.equal(parseShell('cat `ls`')?.segments[0]?.hasCommandSubst, true);
});

test('parser: command substitution inside single quotes is inert', () => {
  const r = parseShell(`echo '$(ls)'`);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.hasCommandSubst, false);
});

test('parser: rejects control characters', () => {
  const r = parseShell('echo a\x1b[31mred');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'command contains control characters');
});

test('parser: rejects heredocs', () => {
  const r = parseShell('cat <<EOF\nhello\nEOF');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'heredocs are not supported');
});

test('parser: rejects unbalanced quotes', () => {
  const r = parseShell(`echo "unclosed`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unbalanced quotes');
});

test('parser: rejects empty commands', () => {
  const r = parseShell('   ');
  assert.equal(r.ok, false);
});

test('parser: unwraps transparent wrappers (time, nohup, nice)', () => {
  const r = parseShell('time nohup nice git push --force');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.cmd, 'git');
  assert.deepEqual(r.segments[0]?.args, ['push', '--force']);
});

test('parser: strips env KEY=VALUE prefix before the command', () => {
  const r = parseShell('env FOO=1 BAR=2 ls -la');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.cmd, 'ls');
});

test('parser: bare env stays env (read-only)', () => {
  const r = parseShell('env');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.cmd, 'env');
});

test('parser: records redirect read/write targets as metadata', () => {
  const r = parseShell('echo hi > out.txt 2> err.txt < in.txt');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const seg = r.segments[0];
  assert.equal(seg?.cmd, 'echo');
  assert.deepEqual(seg?.args, ['hi']);
  assert.deepEqual(
    seg?.writes.map((w) => w.path),
    ['out.txt', 'err.txt'],
  );
  assert.deepEqual(seg?.reads, ['in.txt']);
});

test('parser: numeric fd prefixes are skipped', () => {
  const r = parseShell('echo hi 2> err.txt');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.cmd, 'echo');
  assert.deepEqual(r.segments[0]?.args, ['hi']);
});
