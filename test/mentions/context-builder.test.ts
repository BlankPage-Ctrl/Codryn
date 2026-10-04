import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildInlinePrompt,
  buildMentionRequest,
  toContextParts,
} from '../../src/mentions/engines/context-builder.js';
import { tokenize } from '../../src/mentions/engines/lexer.js';
import type { ParticipantRegistration } from '../../src/mentions/types/participant.js';
import type { ResolvedReference } from '../../src/mentions/types/reference.js';

const participant: ParticipantRegistration = {
  id: 'codryn.workspace',
  name: 'workspace',
  fullName: 'Workspace',
  description: 'Workspace',
};

function makeReference(overrides: Partial<ResolvedReference> = {}): ResolvedReference {
  return {
    id: 'file',
    name: 'file:src/utils.ts',
    range: { start: 20, end: 38 },
    value: { content: 'export const x = 1;' },
    modelDescription: 'Content of src/utils.ts:\n```typescript\nexport const x = 1;\n```',
    tool: 'read_file',
    ...overrides,
  };
}

test('buildMentionRequest: strips mention syntax (Strategy A)', () => {
  const tokens = tokenize('@workspace /explain #file:src/utils.ts refactor this');
  const request = buildMentionRequest({
    originalPrompt: '@workspace /explain #file:src/utils.ts refactor this',
    tokens,
    participant,
    command: 'explain',
    references: [makeReference()],
    toolReferences: [{ name: 'read_file' }],
    tokenBudget: 0,
  });

  assert.equal(request.cleanPrompt, 'refactor this');
  assert.deepEqual(request.participant, {
    id: 'codryn.workspace',
    name: 'workspace',
    fullName: 'Workspace',
  });
  assert.equal(request.command, 'explain');
  assert.equal(request.references.length, 1);
  assert.deepEqual(request.references[0].range, { start: 20, end: 38 });
  assert.deepEqual(request.metadata, {
    originalPrompt: '@workspace /explain #file:src/utils.ts refactor this',
    tokenBudget: 0,
    history: undefined,
  });
});

test('buildMentionRequest: null participant and command', () => {
  const tokens = tokenize('refactor this #file:a.ts');
  const request = buildMentionRequest({
    originalPrompt: 'refactor this #file:a.ts',
    tokens,
    participant: null,
    command: null,
    references: [],
    toolReferences: [],
    tokenBudget: 0,
  });

  assert.equal(request.participant, null);
  assert.equal(request.command, null);
  assert.equal(request.cleanPrompt, 'refactor this');
});

test('buildInlinePrompt: inlines reference model descriptions (Strategy B)', () => {
  const tokens = tokenize('explain #file:src/utils.ts line 10');
  const reference = makeReference({ range: { start: 8, end: 26 } });
  const prompt = buildInlinePrompt(tokens, [reference]);

  assert.equal(
    prompt,
    'explain Content of src/utils.ts:\n```typescript\nexport const x = 1;\n``` line 10',
  );
});

test('buildInlinePrompt: unresolved reference is dropped', () => {
  const tokens = tokenize('explain #file:a.ts');
  const prompt = buildInlinePrompt(tokens, []);
  assert.equal(prompt, 'explain');
});

test('toContextParts: maps resolved references to context parts', () => {
  const parts = toContextParts([makeReference()]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].id, 'file');
  assert.equal(parts[0].name, 'file:src/utils.ts');
  assert.deepEqual(parts[0].value, { content: 'export const x = 1;' });
});
