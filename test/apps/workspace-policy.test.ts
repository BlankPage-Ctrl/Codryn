import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadWorkspacePolicy } from '../../apps/shared/workspace-policy.js';
import { defaultTerminalPolicy, type TerminalPolicy } from '../../src/shell/index.js';

async function tempRoot(t: { after: (fn: () => void) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'ws-policy-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('workspace policy: parses a valid terminal-policy.toml', async (t) => {
  const root = await tempRoot(t);
  await mkdir(join(root, '.codryn'), { recursive: true });
  await writeFile(
    join(root, '.codryn', 'terminal-policy.toml'),
    'mode = "deny"\nallow = ["touch *.txt"]\nask = ["npm install"]\n',
    'utf-8',
  );

  const policy = loadWorkspacePolicy(root);
  assert.deepEqual(policy, {
    mode: 'deny',
    allow: ['touch *.txt'],
    ask: ['npm install'],
    deny: [],
  });
});

test('workspace policy: missing file falls back to the safe default and writes nothing', async (t) => {
  const root = await tempRoot(t);
  const policy = loadWorkspacePolicy(root);
  assert.deepEqual(policy, defaultTerminalPolicy());
  assert.equal(existsSync(join(root, '.codryn', 'terminal-policy.toml')), false);
});

test('workspace policy: malformed file falls back to the safe default', async (t) => {
  const root = await tempRoot(t);
  await mkdir(join(root, '.codryn'), { recursive: true });
  await writeFile(
    join(root, '.codryn', 'terminal-policy.toml'),
    'mode = "not-a-verdict"\n',
    'utf-8',
  );

  const policy: TerminalPolicy = loadWorkspacePolicy(root);
  assert.deepEqual(policy, defaultTerminalPolicy());
});
