import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileReferenceResolver } from '../../apps/shared/mentions/resolver/file.js';
import { MentionService } from '../../src/mentions/services/mention.js';
import type {
  CommandRegistration,
  ParticipantRegistration,
} from '../../src/mentions/types/participant.js';
import type { ResolutionContext } from '../../src/mentions/types/reference.js';
import { MentionInputError } from '../../src/mentions/types/errors.js';

const workspace: ParticipantRegistration = {
  id: 'codryn.workspace',
  name: 'workspace',
  fullName: 'Workspace',
  description: 'Explore the workspace',
  isSticky: true,
  commands: [{ name: 'explain', description: 'Explain code' }],
  detectionExamples: ['list files', 'read file'],
};

const general: ParticipantRegistration = {
  id: 'codryn.general',
  name: 'general',
  fullName: 'General',
  description: 'General-purpose assistant',
};

const commands: CommandRegistration[] = [{ name: 'explain', description: 'Explain code' }];

function makeMockConsumer() {
  return {
    readFile: async (requestedPath: string) => ({
      success: true as const,
      data: {
        path: requestedPath,
        content: `content-of:/tmp/ws/${requestedPath}`,
        encoding: 'utf-8' as const,
        size: requestedPath.length,
        truncated: false,
      },
    }),
  };
}

function makeService(): MentionService {
  return new MentionService({
    participants: [workspace, general],
    commands,
    resolvers: [new FileReferenceResolver(makeMockConsumer())],
  });
}

function makeContext(overrides: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    workspaceRoot: '/tmp/ws',
    resolvePath: (rel) => `/tmp/ws/${rel}`,
    ...overrides,
  };
}

test('MentionService: full parse with participant, command and references', async () => {
  const service = makeService();
  const request = await service.parse('@workspace /explain #file:src/utils.ts what is this?', {
    context: makeContext(),
  });

  assert.equal(request.participant?.name, 'workspace');
  assert.equal(request.command, 'explain');
  assert.equal(request.cleanPrompt, 'what is this?');
  assert.equal(request.references.length, 1);
  assert.equal(
    (request.references[0].value as { content: string }).content,
    'content-of:/tmp/ws/src/utils.ts',
  );
  assert.equal(request.toolReferences[0].name, 'read_file');
  assert.equal(
    request.metadata.originalPrompt,
    '@workspace /explain #file:src/utils.ts what is this?',
  );
});

test('MentionService: sticky participant persists across turns', async () => {
  const service = makeService();

  await service.parse('@workspace read #file:a.ts', { context: makeContext() });
  assert.equal(service.activeParticipantName, 'workspace');

  const next = await service.parse('now explain it', { context: makeContext() });
  assert.equal(next.participant?.name, 'workspace');
});

test('MentionService: explicit @switches away from sticky participant', async () => {
  const service = makeService();

  await service.parse('@workspace read this', { context: makeContext() });
  const next = await service.parse('@general hello', { context: makeContext() });
  assert.equal(next.participant?.name, 'general');
});

test('MentionService: auto-detects participant from detection examples', async () => {
  const service = makeService();
  const request = await service.parse('please list files in the project', {
    context: makeContext(),
  });
  assert.equal(request.participant?.name, 'workspace');
});

test('MentionService: no implicit participant when none matches', async () => {
  const service = makeService();
  const request = await service.parse('hello there', { context: makeContext() });
  assert.equal(request.participant, null);
});

test('MentionService: unknown participant is kept in cleanPrompt', async () => {
  const service = makeService();
  const request = await service.parse('@unknown /explain fix this', {
    context: makeContext(),
  });
  assert.equal(request.participant, null);
  assert.ok(request.cleanPrompt.includes('@unknown'));
  assert.ok(request.cleanPrompt.includes('fix this'));
});

test('MentionService: unknown command is kept in cleanPrompt', async () => {
  const service = makeService();
  const request = await service.parse('@workspace /nonsense do a thing', {
    context: makeContext(),
  });
  assert.equal(request.command, null);
  assert.equal(request.cleanPrompt, '/nonsense do a thing');
});

test('MentionService: unknown reference kind yields error flag, no crash', async () => {
  const service = makeService();
  const request = await service.parse('read #bogus:stuff please', {
    context: makeContext(),
  });
  assert.equal(request.references.length, 1);
  assert.ok(request.references[0].error);
  assert.equal(request.references[0].id, 'bogus');
  assert.equal(request.toolReferences.length, 0);
});

test('MentionService: reference range tracks original token position', async () => {
  const service = makeService();
  const request = await service.parse('explain #file:a.ts now', { context: makeContext() });
  assert.deepEqual(request.references[0].range, { start: 8, end: 18 });
});

test('MentionService: abort signal marks resolution as aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const service = makeService();
  const request = await service.parse('#file:a.ts', {
    context: makeContext({ signal: controller.signal }),
  });
  assert.equal(request.references[0].error?.message, 'Reference resolution aborted');
});

test('MentionService: oversized input throws MentionInputError', async () => {
  const service = makeService();
  await assert.rejects(
    service.parse('x'.repeat(50_001), { context: makeContext() }),
    MentionInputError,
  );
});

test('MentionService: provideCompletionItems returns @, #, / suggestions', async () => {
  const service = makeService();

  const participants = service.provideCompletionItems('hello @work', 11);
  assert.ok(participants.some((s) => s.kind === 'participant' && s.label === '@workspace'));

  const commands = service.provideCompletionItems('@workspace /ex', 14);
  assert.ok(commands.some((s) => s.kind === 'command' && s.label === '/explain'));

  const references = service.provideCompletionItems('read #fi', 8);
  assert.ok(references.some((s) => s.kind === 'reference' && s.label === '#file'));

  const none = service.provideCompletionItems('plain text', 5);
  assert.deepEqual(none, []);
});
