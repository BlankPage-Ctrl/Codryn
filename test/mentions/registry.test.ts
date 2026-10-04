import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandRegistry } from '../../src/mentions/engines/commands.js';
import { MentionRegistry } from '../../src/mentions/engines/registry.js';
import type { ParticipantRegistration } from '../../src/mentions/types/participant.js';

const workspace: ParticipantRegistration = {
  id: 'codryn.workspace',
  name: 'workspace',
  fullName: 'Workspace',
  description: 'Explore the workspace',
  isSticky: true,
  commands: [{ name: 'explain', description: 'Explain code' }],
  detectionExamples: ['list files', 'find file'],
};

test('MentionRegistry: register and resolve by name', () => {
  const registry = new MentionRegistry();
  registry.register(workspace);

  assert.equal(registry.resolve('workspace')?.id, 'codryn.workspace');
  assert.equal(registry.resolve('nope'), undefined);
});

test('MentionRegistry: duplicate registration throws', () => {
  const registry = new MentionRegistry();
  registry.register(workspace);
  assert.throws(() => registry.register(workspace), /already registered/);
});

test('MentionRegistry: detectParticipant matches detection examples', () => {
  const registry = new MentionRegistry();
  registry.register(workspace);

  assert.equal(registry.detectParticipant('please list files here')?.name, 'workspace');
  assert.equal(registry.detectParticipant('how does react work?'), undefined);
});

test('MentionRegistry: detectParticipant picks the best match', () => {
  const registry = new MentionRegistry();
  registry.register(workspace);
  registry.register({
    id: 'codryn.files',
    name: 'files',
    fullName: 'Files',
    description: 'File helper',
    detectionExamples: ['list files', 'delete files'],
  });

  const hit = registry.detectParticipant('please delete files now');
  assert.equal(hit?.name, 'files');
});

test('CommandRegistry: register, resolve and list', () => {
  const registry = new CommandRegistry();
  registry.register({ name: 'explain', description: 'Explain' });
  registry.register({ name: 'fix', description: 'Fix' });

  assert.equal(registry.resolve('fix')?.description, 'Fix');
  assert.equal(registry.resolve('nope'), undefined);
  assert.deepEqual(
    registry.list().map((c) => c.name),
    ['explain', 'fix'],
  );
});

test('CommandRegistry: duplicate registration throws', () => {
  const registry = new CommandRegistry();
  registry.register({ name: 'explain', description: 'Explain' });
  assert.throws(
    () => registry.register({ name: 'explain', description: 'Again' }),
    /already registered/,
  );
});
