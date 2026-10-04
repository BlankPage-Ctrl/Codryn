import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadSkillFile, parseSkillFile, sampleSkillFiles } from '../../apps/skills/parser.js';

const FILE = '/skills/demo/SKILL.md';

test('parseSkillFile: parses well-formed frontmatter via the proven path', () => {
  const skill = parseSkillFile(
    '---\nname: go-concurrency\ndescription: Write concurrent Go\n---\n\n# Body\n',
    FILE,
  );
  assert.ok(skill);
  assert.equal(skill.name, 'go-concurrency');
  assert.equal(skill.description, 'Write concurrent Go');
  assert.equal(skill.content, '# Body');
  assert.equal(skill.location, FILE);
  assert.equal(skill.directory, '/skills/demo');
});

test('parseSkillFile: handles quoted values containing colons', () => {
  const skill = parseSkillFile(
    '---\nname: "quoted: name"\ndescription: \'Fix A: B\'\n---\n\nBody\n',
    FILE,
  );
  assert.ok(skill);
  assert.equal(skill.name, 'quoted: name');
  assert.equal(skill.description, 'Fix A: B');
});

test('parseSkillFile: handles block scalar descriptions', () => {
  const skill = parseSkillFile(
    '---\nname: long-desc\ndescription: |\n  Line one\n  Line two\n---\n\nBody\n',
    FILE,
  );
  assert.ok(skill);
  assert.ok(skill.description.includes('Line one'));
  assert.ok(skill.description.includes('Line two'));
});

test('parseSkillFile: sloppy unquoted colon still loads via lenient fallback', () => {
  const skill = parseSkillFile(
    '---\nname: sloppy\ndescription: Fix A: B without quotes\n---\n\nBody\n',
    FILE,
  );
  assert.ok(skill);
  assert.equal(skill.name, 'sloppy');
  assert.equal(skill.description, 'Fix A: B without quotes');
});

test('parseSkillFile: rejects missing or non-string name/description', () => {
  assert.equal(parseSkillFile('---\ndescription: no name\n---\n\nBody\n', FILE), null);
  assert.equal(parseSkillFile('---\nname: no-desc\n---\n\nBody\n', FILE), null);
  assert.equal(
    parseSkillFile('---\nname: 42\ndescription: numeric name\n---\n\nBody\n', FILE),
    null,
  );
  assert.equal(parseSkillFile('Just a body, no frontmatter\n', FILE), null);
});

test('parseSkillFile: handles CRLF line endings', () => {
  const skill = parseSkillFile(
    '---\r\nname: crlf\r\ndescription: windows file\r\n---\r\n\r\nBody\r\n',
    FILE,
  );
  assert.ok(skill);
  assert.equal(skill.name, 'crlf');
  assert.equal(skill.content, 'Body');
});

test('loadSkillFile: returns null for missing files', async () => {
  assert.equal(await loadSkillFile('/does/not/exist/SKILL.md'), null);
});

test('loadSkillFile: returns null for oversized files', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'skill-big-'));
  try {
    const file = path.join(dir, 'SKILL.md');
    writeFileSync(file, `---\nname: big\ndescription: too big\n---\n\n${'x'.repeat(2_000_000)}\n`);
    assert.equal(await loadSkillFile(file), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sampleSkillFiles: excludes SKILL.md, marks dirs, sorts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'skill-sib-'));
  try {
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: x\ndescription: y\n---\n');
    writeFileSync(path.join(dir, 'b.sh'), 'echo');
    writeFileSync(path.join(dir, 'a.md'), 'doc');
    mkdirSync(path.join(dir, 'scripts'));
    assert.deepEqual(await sampleSkillFiles(dir), ['a.md', 'b.sh', 'scripts/']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sampleSkillFiles: returns [] for missing directories', async () => {
  assert.deepEqual(await sampleSkillFiles('/does/not/exist'), []);
});
