import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  clearInsightBinaryCacheForTest,
  compareSemver,
  describeInsightCompat,
  ensureInsightBinary,
  findInsightBinary,
  isInsightVersionCompatible,
  parseInsightVersionOutput,
  parseSemver,
} from '../../apps/insight/binary.js';
import { InsightBinaryError } from '../../apps/insight/execute/errors.js';

delete process.env.INSIGHT_BINARY;

function makeRoot(files: string[]): { root: string; bindir: string } {
  const root = mkdtempSync(join(tmpdir(), 'insight-bin-'));
  const bindir = join(root, 'packages', 'backend', 'srcinsight');
  mkdirSync(bindir, { recursive: true });
  for (const f of files) writeFileSync(join(bindir, f), 'fake');
  return { root, bindir };
}

test('parseSemver handles v prefix and rejects garbage', () => {
  assert.deepEqual(parseSemver('0.0.10'), [0, 0, 10]);
  assert.deepEqual(parseSemver('v1.1.28'), [1, 1, 28]);
  assert.equal(parseSemver('1.2'), null);
  assert.equal(parseSemver('abc'), null);
});

test('compareSemver orders versions', () => {
  assert.equal(compareSemver('0.0.9', '0.0.10'), -1);
  assert.equal(compareSemver('0.0.10', '0.0.10'), 0);
  assert.equal(compareSemver('1.1.28', '1.0.10'), 1);
  assert.throws(() => compareSemver('nope', '0.0.10'), InsightBinaryError);
});

test('parseInsightVersionOutput reads real binary format', () => {
  const p = parseInsightVersionOutput(
    'srcinsight v0.0.10 (commit b2f638e, built 2026-09-27T11:51:35Z)\n',
  );
  assert.equal(p?.version, '0.0.10');
  assert.equal(p?.commit, 'b2f638e');
  assert.equal(p?.builtAt, '2026-09-27T11:51:35Z');
  assert.equal(parseInsightVersionOutput('garbage line\n')?.version, undefined);
  assert.equal(parseInsightVersionOutput(''), null);
});

test('compat: min-only range starting at v0.0.10', () => {
  assert.equal(isInsightVersionCompatible('0.0.10', '0.0.10', undefined), true);
  assert.equal(isInsightVersionCompatible('0.0.9', '0.0.10', undefined), false);
  assert.equal(isInsightVersionCompatible('1.1.28', '0.0.10', undefined), true);
  assert.equal(isInsightVersionCompatible('bogus', '0.0.10', undefined), false);
});

test('compat: explicit max and pinned exact', () => {
  assert.equal(isInsightVersionCompatible('1.1.29', '1.0.10', '1.1.28'), false);
  assert.equal(isInsightVersionCompatible('1.0.9', '1.0.10', '1.1.28'), false);
  assert.equal(isInsightVersionCompatible('1.1.0', '1.0.10', '1.1.28'), true);
  assert.equal(isInsightVersionCompatible('1.1.28', '1.1.28', '1.1.28'), true);
  assert.equal(isInsightVersionCompatible('1.1.27', '1.1.28', '1.1.28'), false);
  assert.equal(describeInsightCompat('1.0.10', '1.1.28'), 'from v1.0.10 to v1.1.28');
  assert.equal(describeInsightCompat('1.1.28', '1.1.28'), 'only v1.1.28');
  assert.equal(describeInsightCompat('0.0.10', undefined), '>= v0.0.10');
});

test('find: linux picks highest versioned binary', () => {
  const { root, bindir } = makeRoot([
    'srcinsight',
    'srcinsight-v0.0.9-linux-amd64',
    'srcinsight-v0.0.10-linux-amd64',
  ]);
  const hit = findInsightBinary({
    platform: 'linux',
    homeDir: join(root, 'nohome'),
    cwd: root,
    here: root,
  });
  assert.equal(hit?.source, 'dev');
  assert.equal(hit?.path, join(bindir, 'srcinsight-v0.0.10-linux-amd64'));
});

test('find: win32 prefers .exe over plain file', () => {
  const { root } = makeRoot(['srcinsight', 'srcinsight-v0.0.10-windows-amd64.exe']);
  const hit = findInsightBinary({
    platform: 'win32',
    homeDir: join(root, 'nohome'),
    cwd: root,
    here: root,
  });
  assert.ok(hit?.path.endsWith('.exe'));
});

test('find: explicit override and env passthrough', () => {
  const { bindir } = makeRoot(['custom-bin']);
  const target = join(bindir, 'custom-bin');
  assert.equal(findInsightBinary({ override: target })?.source, 'override');
  assert.equal(findInsightBinary({ envBinary: target })?.source, 'env');
  assert.throws(() => findInsightBinary({ override: join(bindir, 'missing') }), InsightBinaryError);
});

test('find: prod dir wins over dev dir', () => {
  const { root } = makeRoot(['srcinsight-v0.0.10-linux-amd64']);
  const prod = join(root, 'home', 'codryn', 'backend', 'bin', 'insight');
  mkdirSync(prod, { recursive: true });
  writeFileSync(join(prod, 'srcinsight-v9.9.9-linux-amd64'), 'fake');
  const hit = findInsightBinary({
    platform: 'linux',
    homeDir: join(root, 'home'),
    cwd: root,
    here: root,
  });
  assert.equal(hit?.source, 'prod');
  assert.equal(hit?.path, join(prod, 'srcinsight-v9.9.9-linux-amd64'));
});

test('find: null when nothing exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'insight-empty-'));
  assert.equal(findInsightBinary({ homeDir: join(root, 'nohome'), cwd: root, here: root }), null);
});

test('ensure: missing binary throws with searched dirs', async () => {
  clearInsightBinaryCacheForTest();
  const root = mkdtempSync(join(tmpdir(), 'insight-miss-'));
  await assert.rejects(
    () =>
      ensureInsightBinary({ findOpts: { homeDir: join(root, 'nohome'), cwd: root, here: root } }),
    (err: unknown) => err instanceof InsightBinaryError && /not found/.test(err.message),
  );
});

test('ensure: mismatch warns but still runs (warn-only)', async () => {
  clearInsightBinaryCacheForTest();
  const { root } = makeRoot(['srcinsight-v0.0.9-fake']);
  const warnings: string[] = [];
  const info = await ensureInsightBinary({
    logger: { warn: (_o: unknown, m?: string) => warnings.push(m ?? '') },
    run: async () => 'srcinsight v0.0.9 (commit abc1234, built 2026-01-01T00:00:00Z)',
    findOpts: { platform: 'linux', homeDir: join(root, 'nohome'), cwd: root, here: root },
  });
  assert.equal(info.version, '0.0.9');
  assert.equal(info.compatible, false);
  assert.ok(info.warning);
  assert.equal(warnings.length, 1);
});

test('ensure: matching version is compatible', async () => {
  clearInsightBinaryCacheForTest();
  const { root } = makeRoot(['srcinsight-v0.0.10-fake']);
  const info = await ensureInsightBinary({
    run: async () => 'srcinsight v0.0.10 (commit b2f638e, built 2026-09-27T11:51:35Z)',
    findOpts: { platform: 'linux', homeDir: join(root, 'nohome'), cwd: root, here: root },
  });
  assert.equal(info.version, '0.0.10');
  assert.equal(info.compatible, true);
  assert.equal(info.warning, undefined);
});

test('ensure: probe failure warns with unknown version but still runs', async () => {
  clearInsightBinaryCacheForTest();
  const { root } = makeRoot(['srcinsight-v0.0.10-unprobed']);
  const info = await ensureInsightBinary({
    run: async () => {
      throw new Error('spawn ENOENT');
    },
    findOpts: { platform: 'linux', homeDir: join(root, 'nohome'), cwd: root, here: root },
  });
  assert.equal(info.version, null);
  assert.equal(info.compatible, true);
  assert.ok(info.warning);
});
