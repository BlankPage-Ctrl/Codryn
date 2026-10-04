import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigService, loadToml, t } from '../../src/config/index.js';

const shape = {
  server: {
    port: t.number().default(3000),
    host: t.string().default('127.0.0.1'),
  },
  database: {
    path: t.string().default('data.db'),
  },
};

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'codryn-config-repair-'));
}

function listBackups(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith('config.toml.bak.'));
}

test('auto-repair: missing file generates full defaults', () => {
  const dir = makeDir();
  const svc = new ConfigService(shape).fromFile('config.toml', dir);
  const config = svc.build() as { server: { port: number } };
  assert.equal(config.server.port, 3000);
  assert.equal(svc.lastRepair.repaired, true);
  assert.equal(svc.lastRepair.created, true);
  assert.equal(svc.lastRepair.backupPath, null);
  const onDisk = loadToml('config.toml', { basePath: dir });
  assert.equal((onDisk.server as Record<string, unknown>).port, 3000);
});

test('auto-repair: missing section is regenerated, other sections kept', () => {
  const dir = makeDir();
  writeFileSync(join(dir, 'config.toml'), '[server]\nport = 4001\nhost = "127.0.0.1"\n', 'utf-8');
  const svc = new ConfigService(shape).fromFile('config.toml', dir);
  const config = svc.build() as { server: { port: number }; database: { path: string } };
  assert.equal(config.server.port, 4001);
  assert.equal(config.database.path, 'data.db');
  assert.equal(svc.lastRepair.repaired, true);
  assert.equal(listBackups(dir).length, 0);
  const onDisk = loadToml('config.toml', { basePath: dir });
  assert.equal((onDisk.database as Record<string, unknown>).path, 'data.db');
});

test('auto-repair: missing leaf key is regenerated with default', () => {
  const dir = makeDir();
  writeFileSync(
    join(dir, 'config.toml'),
    '[server]\nhost = "127.0.0.1"\n[database]\npath = "custom.db"\n',
    'utf-8',
  );
  const svc = new ConfigService(shape).fromFile('config.toml', dir);
  const config = svc.build() as { server: { port: number; host: string } };
  assert.equal(config.server.port, 3000);
  assert.equal(config.server.host, '127.0.0.1');
  const onDisk = loadToml('config.toml', { basePath: dir });
  assert.equal((onDisk.server as Record<string, unknown>).port, 3000);
});

test('auto-repair: unknown extra keys are preserved on disk', () => {
  const dir = makeDir();
  writeFileSync(
    join(dir, 'config.toml'),
    '[server]\nport = 3000\nhost = "0.0.0.0"\ncustomFlag = "keep-me"\n[database]\npath = "data.db"\n',
    'utf-8',
  );
  const svc = new ConfigService(shape).fromFile('config.toml', dir);
  svc.build();
  const raw = readFileSync(join(dir, 'config.toml'), 'utf-8');
  assert.match(raw, /customFlag/);
});

test('auto-repair: wrong-typed value is replaced with default and backup is created', () => {
  const dir = makeDir();
  writeFileSync(
    join(dir, 'config.toml'),
    '[server]\nport = "not-a-number"\nhost = "127.0.0.1"\n[database]\npath = "keep.db"\n',
    'utf-8',
  );
  const svc = new ConfigService(shape).fromFile('config.toml', dir);
  const config = svc.build() as {
    server: { port: number; host: string };
    database: { path: string };
  };
  assert.equal(config.server.port, 3000);
  assert.equal(config.server.host, '127.0.0.1');
  assert.equal(config.database.path, 'keep.db');
  assert.equal(svc.lastRepair.repaired, true);
  assert.ok(svc.lastRepair.backupPath);
  assert.equal(listBackups(dir).length, 1);
  const onDisk = loadToml('config.toml', { basePath: dir });
  assert.equal((onDisk.server as Record<string, unknown>).port, 3000);
});

test('auto-repair: corrupt TOML syntax is backed up and replaced with defaults', () => {
  const dir = makeDir();
  writeFileSync(join(dir, 'config.toml'), '[[[ this is not valid toml', 'utf-8');
  const svc = new ConfigService(shape).fromFile('config.toml', dir);
  const config = svc.build() as { server: { port: number } };
  assert.equal(config.server.port, 3000);
  assert.equal(svc.lastRepair.repaired, true);
  assert.ok(svc.lastRepair.backupPath);
  assert.equal(listBackups(dir).length, 1);
  const onDisk = loadToml('config.toml', { basePath: dir });
  assert.equal((onDisk.server as Record<string, unknown>).port, 3000);
});

test('auto-repair: second load of a healthy file rewrites nothing', () => {
  const dir = makeDir();
  new ConfigService(shape).fromFile('config.toml', dir);
  const before = statSync(join(dir, 'config.toml')).mtimeMs;
  const svc = new ConfigService(shape).fromFile('config.toml', dir);
  svc.build();
  assert.equal(svc.lastRepair.repaired, false);
  assert.equal(statSync(join(dir, 'config.toml')).mtimeMs, before);
});
