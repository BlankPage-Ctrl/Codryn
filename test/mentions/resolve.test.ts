import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileReferenceResolver } from '../../apps/shared/mentions/resolver/file.js';
import { MentionService } from '../../src/mentions/services/mention.js';
import type { ResolutionContext } from '../../src/mentions/types/reference.js';
import { buildMentionArtifacts } from '../../apps/shared/mention.js';

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
  return new MentionService({ resolvers: [new FileReferenceResolver(makeMockConsumer())] });
}

function makeContext(): ResolutionContext {
  return {
    workspaceRoot: '/tmp/ws',
    resolvePath: (rel) => `/tmp/ws/${rel}`,
  };
}

test('buildMentionArtifacts: #file reference inlines content as bysystem text part', async () => {
  const result = await buildMentionArtifacts(
    makeService(),
    makeContext(),
    'explain #file:a.ts now',
  );

  assert.ok(result.bysystemPart);
  assert.equal(result.bysystemPart.type, 'text');
  assert.equal(result.bysystemPart.isSystem, true);
  assert.ok(result.bysystemPart.text.includes('content-of:/tmp/ws/a.ts'));
  assert.ok(result.bysystemPart.text.includes('```typescript'));
  assert.equal(result.request?.references.length, 1);
});

test('buildMentionArtifacts: plain text yields no bysystem part', async () => {
  const result = await buildMentionArtifacts(makeService(), makeContext(), 'hello there');

  assert.equal(result.bysystemPart, null);
  assert.equal(result.request?.references.length, 0);
});

test('buildMentionArtifacts: unresolved reference does not crash and yields no bysystem part', async () => {
  const result = await buildMentionArtifacts(makeService(), makeContext(), 'read #bogus:x please');

  assert.equal(result.bysystemPart, null);
  assert.ok(result.request?.references[0].error);
});

test('buildMentionArtifacts: oversized input falls back safely', async () => {
  const result = await buildMentionArtifacts(makeService(), makeContext(), 'x'.repeat(50_001));

  assert.equal(result.bysystemPart, null);
  assert.equal(result.request, null);
});
