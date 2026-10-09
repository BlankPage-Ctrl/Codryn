import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildPluginBootstrap,
  collectHookRules,
  commandDeniedByRules,
  dedupeToolDecls,
  isPluginEnabled,
  loadCodrynManifest,
  loadPluginDirSkills,
  loadPluginRegistry,
  loadPluginStates,
  matchHookRule,
  pluginKey,
  projectPluginsFile,
  scanPluginCaps,
  scanToolDeclarations,
  setPluginEnabled,
  toolDeniedByRules,
  type PluginHookRule,
} from '../../apps/plugins/index.js';
import { resolvePluginPermissionViaHitl } from '../../apps/shared/plugin-permission.js';
import { AppError } from '../../apps/shared/errors.js';
import { getPlugin } from '../../apps/actions/get.plugin.js';
import { listPlugins } from '../../apps/actions/list.plugin.js';
import { setPluginEnabled as setPluginEnabledAction } from '../../apps/actions/set.plugin.js';
import {
  applyGlobalLimits,
  DEFAULT_PLUGIN_CONFIG,
  toPluginLimits,
} from '../../apps/plugins/config.js';
import {
  clearSkillCache,
  loadSkillContent,
  loadSkillsForWorkspace,
} from '../../apps/skills/index.js';

function memSettings(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getValue: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setValue: async (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

function writeSkill(dir: string, name: string, description: string, body = 'Body'): void {
  const d = path.join(dir, 'skills', name);
  mkdirSync(d, { recursive: true });
  writeFileSync(
    path.join(d, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

function writeManifest(dir: string, manifest: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'codryn-plugin.json'), JSON.stringify(manifest));
}

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    description: 'Demo plugin',
    ...overrides,
  };
}

function writeRegistry(projectPath: string, plugins: unknown): void {
  const file = projectPluginsFile(projectPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(plugins));
}

// --- Layer 1: external registry (unchanged format: Codryn's own) ---

test('registry: project entries win over global, bad entries skipped, bad JSON fail-open', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-reg-'));
  try {
    const projectPath = path.join(tmp, 'proj');
    const globalFile = path.join(tmp, 'global-plugins.json');
    writeFileSync(
      globalFile,
      JSON.stringify({
        plugins: [
          { id: 'alpha', path: '/nowhere/a' },
          { id: 'dup', path: '/nowhere/global' },
          { id: 'BAD ID!', path: '/nowhere/bad' },
        ],
      }),
    );
    writeRegistry(projectPath, {
      plugins: [{ id: 'dup', path: '/nowhere/project' }, { id: 'beta' }],
    });

    const entries = await loadPluginRegistry(projectPath, { globalFile });
    assert.deepEqual(
      entries.map((e) => e.entry.id),
      ['alpha', 'beta', 'dup'],
    );
    assert.equal(
      entries.find((e) => e.entry.id === 'dup')?.dir,
      path.normalize('/nowhere/project'),
    );
    assert.equal(entries.find((e) => e.entry.id === 'beta')?.dir, null);
    assert.equal(entries.find((e) => e.entry.id === 'beta')?.kind, 'git');

    writeFileSync(projectPluginsFile(projectPath), '{not json');
    const fallback = await loadPluginRegistry(projectPath, { globalFile });
    assert.deepEqual(
      fallback.map((e) => e.entry.id),
      ['alpha', 'dup'],
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('settings: plugin key format, default ON, roundtrip', async () => {
  assert.equal(pluginKey('ws1', 'demo'), 'workspace:ws1:plugin:demo');
  const s = memSettings();
  assert.equal(await isPluginEnabled(s, 'ws1', 'demo'), true);
  await setPluginEnabled(s, 'ws1', 'demo', false);
  assert.equal(await isPluginEnabled(s, 'ws1', 'demo'), false);
  await setPluginEnabled(s, 'ws1', 'demo', true);
  assert.equal(await isPluginEnabled(s, 'ws1', 'demo'), true);
});

// --- Layer 2: Codryn-native manifest ---

test('manifest: codryn-plugin.json drives caps (permissions, bootstrap, rules, limits)', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-native-'));
  try {
    const dir = path.join(tmp, 'demo');
    writeManifest(dir, {
      ...baseManifest(),
      permissions: { shell: true, network: false, sensitive: true },
      lifecycle: { bootstrap: 'Always brainstorm first.' },
      hooks: {
        rules: [
          { event: 'PreToolUse', matchTool: 'run_shell', matchCommand: 'rm -rf', decision: 'deny' },
        ],
      },
    });
    writeSkill(dir, 'alpha', 'Alpha skill');

    const loaded = await loadCodrynManifest(dir);
    assert.equal(loaded.manifest?.id, 'demo');
    assert.deepEqual(loaded.notices, []);

    const caps = await scanPluginCaps('demo', dir);
    assert.ok(caps);
    assert.equal(caps.format, 'codryn');
    assert.equal(caps.name, 'Demo');
    assert.equal(caps.version, '1.0.0');
    assert.deepEqual(caps.skills, ['alpha']);
    assert.deepEqual(caps.permissions, { shell: true, network: false, sensitive: true });
    assert.equal(caps.bootstrap, 'Always brainstorm first.');
    assert.equal(caps.hookRules.length, 1);
    assert.equal(caps.hookRules[0]?.decision, 'deny');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('manifest: bare skills dir loads with scanned defaults and a notice', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-bare-'));
  try {
    const dir = path.join(tmp, 'plain');
    writeSkill(dir, 's1', 'First', 'Run shell commands with the API token.');
    const caps = await scanPluginCaps('plain', dir);
    assert.ok(caps);
    assert.equal(caps.format, 'bare');
    assert.equal(caps.name, 'plain');
    assert.equal(caps.permissions.shell, true);
    assert.equal(caps.permissions.sensitive, true);
    assert.equal(caps.permissions.network, false);
    assert.equal(caps.bootstrap, null);
    assert.deepEqual(caps.hookRules, []);
    assert.ok(caps.notices.some((n) => n.includes('bare')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('manifest: Claude Code files are never read', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-claude-'));
  try {
    const dir = path.join(tmp, 'migrated');
    mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      path.join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'claude-name', description: 'Claude description', version: '9.9.9' }),
    );
    mkdirSync(path.join(dir, 'hooks'), { recursive: true });
    writeFileSync(
      path.join(dir, 'hooks', 'hooks.json'),
      JSON.stringify({ hooks: { SessionStart: [] } }),
    );
    writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { db: {} } }));
    mkdirSync(path.join(dir, 'agents'), { recursive: true });
    mkdirSync(path.join(dir, 'commands'), { recursive: true });
    writeSkill(dir, 's1', 'Only skill');

    const caps = await scanPluginCaps('migrated', dir);
    assert.ok(caps);
    assert.equal(caps.format, 'bare');
    assert.equal(caps.name, 'migrated');
    assert.ok(!caps.description.includes('Claude'));
    assert.deepEqual(caps.hookRules, []);
    assert.deepEqual(caps.skills, ['s1']);

    // MCP-only directory contributes nothing (MCP is MCP, plugin is plugin).
    const mcpOnly = path.join(tmp, 'mcponly');
    mkdirSync(mcpOnly, { recursive: true });
    writeFileSync(path.join(mcpOnly, '.mcp.json'), JSON.stringify({ mcpServers: { db: {} } }));
    assert.equal(await scanPluginCaps('mcponly', mcpOnly), null);
    assert.equal(await scanPluginCaps('missing', path.join(tmp, 'nope')), null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('manifest: limits cap skills and reject oversized bodies', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-limits-'));
  try {
    const dir = path.join(tmp, 'demo');
    writeManifest(dir, { ...baseManifest(), limits: { maxSkills: 2, maxSkillBytes: 1_024 } });
    writeSkill(dir, 'a-skill', 'A');
    writeSkill(dir, 'b-skill', 'B', `x${'y'.repeat(2_000)}`);
    writeSkill(dir, 'c-skill', 'C');

    const caps = await scanPluginCaps('demo', dir);
    assert.ok(caps);
    // Alphabetical cap at 2 keeps a/b (c cut); oversized b rejected by bytes.
    assert.deepEqual(caps.skills, ['a-skill']);
    assert.ok(caps.notices.some((n) => n.includes('capped')));
    assert.ok(caps.notices.some((n) => n.includes('b-skill')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('manifest: text-only contract rejects NUL in manifest and skill bodies', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-text-'));
  try {
    const dir = path.join(tmp, 'demo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'codryn-plugin.json'),
      `{"id":"demo","name":"D","version":"1","description":"x\u0000"}`,
    );
    writeSkill(dir, 'ok-skill', 'OK');
    const loaded = await loadCodrynManifest(dir);
    assert.equal(loaded.manifest, null);
    assert.ok(loaded.notices.some((n) => n.includes('NUL')));

    const caps = await scanPluginCaps('demo', dir);
    assert.ok(caps);
    assert.equal(caps.format, 'bare');

    const dir2 = path.join(tmp, 'demo2');
    writeManifest(dir2, baseManifest({ id: 'demo2' }));
    writeSkill(dir2, 'good', 'Good');
    const badDir = path.join(dir2, 'skills', 'bad');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(badDir + '/SKILL.md', '---\nname: bad\ndescription: Bad\n---\n\nA\u0000B\n');
    const caps2 = await scanPluginCaps('demo2', dir2);
    assert.ok(caps2);
    assert.deepEqual(caps2.skills, ['good']);
    assert.ok(caps2.notices.some((n) => n.includes('bad')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Layer 3: declarative hooks ---

function rule(overrides: Partial<PluginHookRule> = {}): PluginHookRule {
  return { event: 'PreToolUse', decision: 'deny', ...overrides };
}

test('hooks: first match wins; tool and command scoped denial', async () => {
  const rules = [
    rule({ matchTool: 'run_shell', matchCommand: 'rm -rf', decision: 'deny' }),
    rule({ matchTool: 'grep', decision: 'deny' }),
    rule({ matchTool: 'run_shell', decision: 'ask' }),
  ];
  const hit = matchHookRule(rules, 'run_shell', 'please rm -rf /tmp now');
  assert.equal(hit?.decision, 'deny');
  assert.equal(matchHookRule(rules, 'run_shell', 'ls -la')?.decision, 'ask');
  assert.equal(matchHookRule(rules, 'read_file', null), null);

  // Command matching is case-insensitive.
  assert.ok(commandDeniedByRules(rules, 'RM -RF /'));
  // Tool-scoped deny needs an exact tool name without command pattern.
  assert.ok(toolDeniedByRules(rules, 'grep'));
  assert.equal(toolDeniedByRules(rules, 'run_shell'), null);
  assert.equal(toolDeniedByRules(rules, 'read_file'), null);
  // Rules for other tools do not touch shell commands.
  assert.equal(
    commandDeniedByRules([rule({ matchTool: 'grep', matchCommand: 'x', decision: 'deny' })], 'x'),
    null,
  );
});

test('hooks: collectHookRules tags plugin id and skips inactive states', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-collect-'));
  try {
    const projectPath = path.join(tmp, 'proj');
    const goodDir = path.join(tmp, 'good');
    writeManifest(goodDir, {
      ...baseManifest(),
      hooks: { rules: [{ event: 'PreToolUse', matchTool: 'grep', decision: 'deny' }] },
    });
    writeSkill(goodDir, 'g-skill', 'Good skill');
    writeRegistry(projectPath, {
      plugins: [
        { id: 'good', path: goodDir },
        { id: 'off', path: goodDir, enabled: false },
      ],
    });
    const { states } = await loadPluginStates(projectPath, 'ws1', memSettings());
    const collected = collectHookRules(states);
    assert.equal(collected.length, 1);
    assert.equal(collected[0]?.pluginId, 'good');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Layer 3+4: guard states, bootstrap context, shared skill index ---

test('guard: states degrade to slots; only bootstrap text reaches the prompt', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-guard-'));
  try {
    const projectPath = path.join(tmp, 'proj');
    const goodDir = path.join(tmp, 'good');
    writeManifest(goodDir, {
      ...baseManifest(),
      permissions: { shell: true, network: false, sensitive: false },
      lifecycle: { bootstrap: 'Brainstorm first.' },
      hooks: { rules: [{ event: 'PreToolUse', matchTool: 'grep', decision: 'deny' }] },
    });
    writeSkill(goodDir, 'g-skill', 'Good skill does things');
    writeRegistry(projectPath, {
      plugins: [
        { id: 'good', path: goodDir },
        { id: 'off', path: goodDir, enabled: false },
        { id: 'remote', source: 'https://example.com/p.git' },
        { id: 'broken', path: path.join(tmp, 'missing') },
      ],
    });

    const s = memSettings();
    const { states, skills } = await loadPluginStates(projectPath, 'ws1', s);
    assert.deepEqual(
      states.map((x) => `${x.id}:${x.status}`),
      ['broken:error', 'good:ready', 'off:disabled', 'remote:not-installed'],
    );
    assert.ok(states.find((x) => x.id === 'broken')?.error);
    assert.deepEqual(
      skills.map((x) => x.name),
      ['g-skill'],
    );
    assert.equal(skills[0]?.pluginId, 'good');

    await setPluginEnabled(s, 'ws1', 'good', false);
    const toggled = await loadPluginStates(projectPath, 'ws1', s);
    assert.equal(toggled.states.find((x) => x.id === 'good')?.status, 'disabled');
    assert.deepEqual(toggled.skills, []);
    assert.equal(buildPluginBootstrap(toggled.states), null);

    const fresh = await loadPluginStates(projectPath, 'ws1', memSettings());
    // Only author bootstrap text reaches the model - no plugin framing,
    // no ids, no notices, no tool mapping.
    assert.equal(buildPluginBootstrap(fresh.states), 'Brainstorm first.');

    // A ready plugin without bootstrap text contributes nothing to the prompt.
    const noboot = await loadPluginStates(projectPath, 'ws1', memSettings());
    const good = noboot.states.find((x) => x.id === 'good');
    assert.ok(good?.caps);
    assert.equal(
      buildPluginBootstrap([{ ...good, caps: { ...good.caps, bootstrap: null } }]),
      null,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('registry: plugin skills slot between project and builtin, project wins duplicates', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-idx-'));
  try {
    const globalRoot = path.join(tmp, 'global');
    mkdirSync(globalRoot, { recursive: true });
    const projectRoot = path.join(tmp, 'proj', '.agents', 'skills');
    const pluginDir = path.join(tmp, 'plug');
    writeManifest(pluginDir, baseManifest({ id: 'plug' }));
    writeSkill(pluginDir, 'p-skill', 'Plugin skill');
    writeSkill(pluginDir, 'dup', 'plugin dup loses');

    const projDir = path.join(projectRoot, 'dup');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      path.join(projDir, 'SKILL.md'),
      '---\nname: dup\ndescription: project dup wins\n---\n\nBody\n',
    );

    const fsPort = (root: string) => ({
      root,
      async listDir(rel: string) {
        const { readdirSync } = await import('node:fs');
        const abs = rel === '.' ? root : path.join(root, rel);
        try {
          return readdirSync(abs, { withFileTypes: true }).map((e) => ({
            name: e.name,
            isDirectory: e.isDirectory(),
          }));
        } catch {
          return null;
        }
      },
      async readFile(rel: string) {
        const { readFileSync } = await import('node:fs');
        try {
          return readFileSync(path.join(root, rel), 'utf-8');
        } catch {
          return null;
        }
      },
    });

    const pluginSkills = await loadPluginDirSkills('plug', pluginDir, ['p-skill', 'dup']);
    const sources = {
      globalRoot,
      project: fsPort(projectRoot),
      pluginSkills: pluginSkills.map((sk) => ({ ...sk })),
    };
    clearSkillCache();
    try {
      const skills = await loadSkillsForWorkspace(sources);
      const names = skills.map((sk) => sk.name);
      assert.ok(names.includes('p-skill'));
      assert.ok(names.includes('dup'));
      assert.ok(names.indexOf('dup') < names.indexOf('p-skill'));
      assert.ok(names.indexOf('p-skill') < names.indexOf('edit-mode'));
      assert.equal(skills.find((sk) => sk.name === 'dup')?.description, 'project dup wins');

      const body = await loadSkillContent(sources, 'p-skill');
      assert.ok(body?.body.includes('Plugin skill') || body?.meta.name === 'p-skill');
    } finally {
      clearSkillCache();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Tool declarations: per-tool sensitivity, author-trusted ---

test('tools: manifest declarations land in caps with dedupe', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-tools-'));
  try {
    const dir = path.join(tmp, 'demo');
    writeManifest(dir, {
      ...baseManifest(),
      tools: [
        { name: 'web-fetch', description: 'Fetch a URL and return text.', sensitive: false },
        { name: 'web-design', description: 'Generate page designs.', sensitive: true },
        { name: 'wipe', description: 'Delete everything.', sensitive: false, destructive: true },
        { name: 'web-fetch', description: 'Duplicate loses.', sensitive: true },
      ],
    });
    writeSkill(dir, 's1', 'Only skill');

    const caps = await scanPluginCaps('demo', dir);
    assert.ok(caps);
    assert.deepEqual(
      caps.tools.map((t) => `${t.name}:${t.sensitive}`),
      ['web-fetch:false', 'web-design:true', 'wipe:false'],
    );
    assert.ok(caps.notices.some((n) => n.includes('duplicate tool')));
    assert.ok(caps.notices.some((n) => n.includes('destructive but not marked sensitive')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('safety: scanner flags mismatched claims, stays silent on clean tools', async () => {
  assert.deepEqual(
    scanToolDeclarations([
      {
        name: 'a',
        description: 'Reads the API token vault.',
        sensitive: false,
        destructive: false,
      },
      {
        name: 'b',
        description: 'Runs shell commands for you.',
        sensitive: false,
        destructive: false,
      },
      {
        name: 'c',
        description: 'Uploads files to an external server.',
        sensitive: false,
        destructive: false,
      },
      { name: 'd', description: 'Formats text nicely.', sensitive: false, destructive: false },
      { name: 'e', description: 'Writes with credentials.', sensitive: true, destructive: false },
    ]),
    [
      'tool "a" claims non-sensitive but mentions credentials.',
      'tool "b" claims non-sensitive but mentions shell execution.',
      'tool "c" claims non-sensitive but mentions external transfer.',
    ],
  );
  assert.deepEqual(
    dedupeToolDecls([
      { name: 'x', description: 'X.', sensitive: false, destructive: false },
      { name: 'X', description: 'Dupe.', sensitive: true, destructive: false },
    ]).length,
    1,
  );
});

test('permission: non-sensitive auto-allows; sensitive asks; failures deny', async () => {
  const opts = { workspaceId: 'ws1', chatId: 'c1' };
  const silent = {
    requestAndWait: async () => {
      throw new Error('must not be called');
    },
  };
  assert.equal(
    await resolvePluginPermissionViaHitl(
      silent as never,
      {
        plugin: 'demo',
        tool: 'web-fetch',
        sensitive: false,
        destructive: false,
        argsPreview: '{}',
      },
      opts,
    ),
    'allow',
  );

  let asked = 0;
  const approver = {
    requestAndWait: async () => {
      asked++;
      return { type: 'approval', response: { outcome: 'approved' } } as never;
    },
  };
  assert.equal(
    await resolvePluginPermissionViaHitl(
      approver as never,
      {
        plugin: 'demo',
        tool: 'web-design',
        sensitive: true,
        destructive: false,
        argsPreview: '{}',
      },
      opts,
    ),
    'allow',
  );
  assert.equal(asked, 1);

  const denier = {
    requestAndWait: async () => ({ type: 'approval', response: { outcome: 'rejected' } }) as never,
  };
  assert.equal(
    await resolvePluginPermissionViaHitl(
      denier as never,
      {
        plugin: 'demo',
        tool: 'web-design',
        sensitive: true,
        destructive: false,
        argsPreview: '{}',
      },
      opts,
    ),
    'deny',
  );
  const failing = {
    requestAndWait: async () => {
      throw new Error('hitl down');
    },
  };
  assert.equal(
    await resolvePluginPermissionViaHitl(
      failing as never,
      {
        plugin: 'demo',
        tool: 'web-design',
        sensitive: true,
        destructive: false,
        argsPreview: '{}',
      },
      opts,
    ),
    'deny',
  );
});

// --- Server config: default off, ceilings, action gating ---

test('config: unofficial feature defaults off; partial merge keeps defaults', async () => {
  assert.equal(DEFAULT_PLUGIN_CONFIG.enabled, false);
  assert.deepEqual(toPluginLimits({}), {
    maxPlugins: 8,
    maxSkillsPerPlugin: 40,
    maxToolsPerPlugin: 16,
  });
  assert.deepEqual(toPluginLimits({ maxPlugins: 2 }), {
    maxPlugins: 2,
    maxSkillsPerPlugin: 40,
    maxToolsPerPlugin: 16,
  });
});

test('config: global ceilings cap skills and tools with notices', async () => {
  const caps = {
    format: 'codryn',
    name: 'd',
    description: 'd',
    version: null,
    skills: ['a', 'b', 'c'],
    permissions: { shell: false, network: false, sensitive: false },
    bootstrap: null,
    hookRules: [],
    tools: [
      { name: 't1', description: 'T1.', sensitive: false, destructive: false },
      { name: 't2', description: 'T2.', sensitive: true, destructive: false },
    ],
    limits: { maxSkills: 40, maxSkillBytes: 1_000_000 },
    notices: [],
  } as const;
  const capped = applyGlobalLimits(
    { ...caps },
    { maxPlugins: 8, maxSkillsPerPlugin: 2, maxToolsPerPlugin: 1 },
  );
  assert.deepEqual(capped.skills, ['a', 'b']);
  assert.deepEqual(
    capped.tools.map((t) => t.name),
    ['t1'],
  );
  assert.equal(capped.notices.length, 2);

  const untouched = applyGlobalLimits(
    { ...caps },
    { maxPlugins: 8, maxSkillsPerPlugin: 40, maxToolsPerPlugin: 16 },
  );
  assert.deepEqual(untouched.skills, ['a', 'b', 'c']);
  assert.deepEqual(untouched.notices, []);
});

function stubActionCtx(projectPath: string, overrides: Record<string, unknown> = {}) {
  return {
    workspacesService: {
      findOne: async (id: string) =>
        id === 'ws1' ? ({ id: 'ws1', projectPath } as never) : (null as never),
    },
    settingsService: memSettings(),
    logger: console,
    pluginsEnabled: true,
    pluginLimits: toPluginLimits({}),
    ...overrides,
  };
}

test('actions: disabled kill switch empties list and forbids get/set', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-gate-'));
  try {
    const projectPath = path.join(tmp, 'proj');
    const dir = path.join(tmp, 'demo');
    writeManifest(dir, baseManifest());
    writeSkill(dir, 's1', 'S1');
    writeRegistry(projectPath, { plugins: [{ id: 'demo', path: dir }] });

    const off = stubActionCtx(projectPath, { pluginsEnabled: false });
    assert.deepEqual((await listPlugins(off as never, { workspaceId: 'ws1' })).plugins, []);
    await assert.rejects(
      getPlugin(off as never, { workspaceId: 'ws1', id: 'demo' }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal((err as AppError).status, 403);
        return true;
      },
    );
    await assert.rejects(
      setPluginEnabledAction(off as never, { workspaceId: 'ws1', id: 'demo', enabled: true }),
      /disabled/,
    );

    const on = stubActionCtx(projectPath);
    const listed = await listPlugins(on as never, { workspaceId: 'ws1' });
    assert.deepEqual(
      listed.plugins.map((p) => `${p.id}:${p.status}`),
      ['demo:ready'],
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('actions: maxPlugins truncates the registry for runs and listing', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plugins-maxp-'));
  try {
    const projectPath = path.join(tmp, 'proj');
    for (const id of ['aaa', 'zzz']) {
      const dir = path.join(tmp, id);
      writeManifest(dir, baseManifest({ id }));
      writeSkill(dir, 's1', 'S1');
    }
    writeRegistry(projectPath, {
      plugins: [
        { id: 'zzz', path: path.join(tmp, 'zzz') },
        { id: 'aaa', path: path.join(tmp, 'aaa') },
      ],
    });
    const ctx = stubActionCtx(projectPath, { pluginLimits: toPluginLimits({ maxPlugins: 1 }) });
    const listed = await listPlugins(ctx as never, { workspaceId: 'ws1' });
    assert.deepEqual(
      listed.plugins.map((p) => p.id),
      ['aaa'],
    );

    const { states } = await loadPluginStates(
      projectPath,
      'ws1',
      memSettings(),
      undefined,
      toPluginLimits({ maxPlugins: 1 }),
    );
    assert.deepEqual(
      states.map((s) => s.id),
      ['aaa'],
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
