import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildSkillMenuPrompt,
  clearSkillCache,
  loadSkillContent,
  loadSkillsForWorkspace,
  type SkillMeta,
} from '../../apps/skills/index.js';
import { createSkillListTool } from '../../apps/agent/tools/skill-list.js';

function meta(name: string, description = `${name} does things`, origin = 'x'): SkillMeta {
  return {
    name,
    description,
    location: `/fake/${origin}/${name}/SKILL.md`,
    directory: `/fake/${origin}/${name}`,
  };
}

test('buildSkillMenuPrompt: empty menu renders nothing', () => {
  assert.equal(buildSkillMenuPrompt([]), '');
});

test('buildSkillMenuPrompt: 5 or fewer skills render as bullets, no overflow', () => {
  const out = buildSkillMenuPrompt([meta('b-skill'), meta('a-skill')]);
  assert.ok(out.includes('- `b-skill`: b-skill does things'));
  assert.ok(out.includes('- `a-skill`: a-skill does things'));
  assert.ok(!out.includes('More ('));
  assert.ok(!out.includes('skill_list'));
});

test('buildSkillMenuPrompt: truncates to 5 with names-only overflow + footer', () => {
  const skills = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((n) => meta(n));
  const out = buildSkillMenuPrompt(skills);
  for (const n of ['s1', 's2', 's3', 's4', 's5']) {
    assert.ok(out.includes(`- \`${n}\`: ${n} does things`), `missing described ${n}`);
  }
  // Overflow names carry no descriptions.
  assert.ok(out.includes('- More (3): `s6`, `s7`, `s8`'));
  assert.ok(out.includes('skill_list'));
  // No tables anywhere.
  assert.ok(!out.includes('|'));
});

test('buildSkillMenuPrompt: custom maxVisible is honored', () => {
  const skills = ['s1', 's2', 's3'].map((n) => meta(n));
  const out = buildSkillMenuPrompt(skills, { maxVisible: 1 });
  assert.ok(out.includes('- `s1`: s1 does things'));
  assert.ok(out.includes('- More (2): `s2`, `s3`'));
});

test('buildSkillMenuPrompt: multiline descriptions are flattened', () => {
  const out = buildSkillMenuPrompt([meta('x', 'line one\nline two')]);
  assert.ok(out.includes('- `x`: line one line two'));
});

// --- Registry ordering: project-first, alphabetical within origin ---

function writeSkill(dir: string, name: string, description: string): void {
  const d = path.join(dir, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(
    path.join(d, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`,
  );
}

function fsPort(root: string) {
  return {
    root,
    async listDir(rel: string) {
      const abs = rel === '.' ? root : path.join(root, rel);
      let entries;
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        return null;
      }
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    },
    async readFile(rel: string) {
      try {
        return readFileSync(path.join(root, rel), 'utf-8');
      } catch {
        return null;
      }
    },
  };
}

test('loadSkillsForWorkspace: project skills sort before global, alphabetical within', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'skills-menu-'));
  try {
    const globalRoot = path.join(tmp, 'global');
    const projectRoot = path.join(tmp, 'proj', '.agents', 'skills');
    writeSkill(globalRoot, 'zebra', 'global z');
    writeSkill(globalRoot, 'apple', 'global a');
    writeSkill(globalRoot, 'dup', 'global dup');
    writeSkill(projectRoot, 'mid', 'project m');
    writeSkill(projectRoot, 'abc', 'project a');
    writeSkill(projectRoot, 'dup', 'project dup wins');
    void statSync(projectRoot);

    const sources = { globalRoot, project: fsPort(projectRoot) };
    clearSkillCache();
    const skills = await loadSkillsForWorkspace(sources);
    const names = skills.map((s) => s.name);
    // Project first (abc, dup, mid), then builtin (edit-mode), then global
    // (apple, zebra). Duplicate won by project.
    assert.deepEqual(names, ['abc', 'dup', 'mid', 'edit-mode', 'apple', 'zebra']);
    assert.equal(skills.find((s) => s.name === 'dup')?.description, 'project dup wins');
  } finally {
    clearSkillCache();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('builtin edit-mode: present by default, project skill overrides it', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'skills-builtin-'));
  try {
    const globalRoot = path.join(tmp, 'global');
    mkdirSync(globalRoot, { recursive: true });
    const projectRoot = path.join(tmp, 'proj', '.agents', 'skills');

    const sources = { globalRoot, project: fsPort(projectRoot) };
    clearSkillCache();
    // No project skill: the shipped builtin is present with its body.
    let skills = await loadSkillsForWorkspace(sources);
    const builtin = skills.find((s) => s.name === 'edit-mode');
    assert.ok(builtin, 'expected builtin edit-mode skill');
    const body = await loadSkillContent(sources, 'edit-mode');
    assert.ok(body?.body.includes('<<<<<<< SEARCH'));

    // A project skill with the same name wins over the builtin.
    writeSkill(projectRoot, 'edit-mode', 'project override');
    clearSkillCache();
    skills = await loadSkillsForWorkspace(sources);
    assert.equal(skills.find((s) => s.name === 'edit-mode')?.description, 'project override');
    const overridden = await loadSkillContent(sources, 'edit-mode');
    assert.ok(overridden?.body.includes('project override'));
  } finally {
    clearSkillCache();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('skill_list: full menu follows system-prompt order; limit truncates with remainder note', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'skill-list-'));
  try {
    const globalRoot = path.join(tmp, 'global');
    const projectRoot = path.join(tmp, 'proj', '.agents', 'skills');
    writeSkill(globalRoot, 'g2', 'second global');
    writeSkill(globalRoot, 'g1', 'first global');
    writeSkill(projectRoot, 'p1', 'only project');

    const sources = { globalRoot, project: fsPort(projectRoot) };
    clearSkillCache();
    await loadSkillsForWorkspace(sources);

    const [tool] = createSkillListTool({ sources });
    assert.equal(tool.name, 'skill_list');
    const full = (await tool.execute({ limit: undefined }, {})) as string;
    const lines = full.split('\n').filter((l) => l.startsWith('- '));
    assert.deepEqual(lines, [
      '- `p1`: only project',
      '- `edit-mode`: Use this skill when starting file edits. Proper tips for create_file and edit_file.',
      '- `g1`: first global',
      '- `g2`: second global',
    ]);

    const limited = (await tool.execute({ limit: 2 }, {})) as string;
    assert.ok(limited.includes('- `p1`: only project'));
    assert.ok(limited.includes('- `edit-mode`:'));
    assert.ok(!limited.includes('g1'));
    assert.ok(limited.includes('…and 2 more'));
  } finally {
    clearSkillCache();
    rmSync(tmp, { recursive: true, force: true });
  }
});
