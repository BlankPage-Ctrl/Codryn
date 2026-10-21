import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PLUGINS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../apps/plugins');

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

test('the tunnel does not import a consumer layer', () => {
  for (const file of sourceFiles(path.join(PLUGINS_DIR, 'runtime'))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /from '\.\.\/(hooks|tools)\//,
      `${file} must not import a consumer layer`,
    );
  }
});

test('the host speaks the tunnel, not the consumers', () => {
  const source = readFileSync(path.join(PLUGINS_DIR, 'host.ts'), 'utf8');
  assert.doesNotMatch(source, /from '\.\/hooks\//, 'host.ts must not import the hook layer');
  assert.doesNotMatch(source, /from '\.\/tools\//, 'host.ts must not import the tool layer');
});

test('a consumer layer does not import the tunnel vocabulary', () => {
  for (const layer of ['hooks', 'tools']) {
    for (const file of sourceFiles(path.join(PLUGINS_DIR, layer))) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(
        source,
        /runtime\/protocol\.js/,
        `${file} must reach the tunnel through the host`,
      );
    }
  }
});

test('no hook vocabulary is left in the tunnel', () => {
  for (const file of sourceFiles(path.join(PLUGINS_DIR, 'runtime'))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /hooks\/|beforeTool|afterTool|beforeExecute|afterExecute/,
      `${file} must not name a hook`,
    );
  }
});
