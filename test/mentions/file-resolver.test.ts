import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { FileReferenceResolver } from '../../apps/shared/mentions/resolver/file.js';
import type { ResolutionContext } from '../../src/mentions/types/reference.js';

function makeConsumer(dir: string) {
  return {
    readFile: async (requestedPath: string, opts?: { maxBytes?: number }) => {
      const abs = resolve(dir, requestedPath);
      try {
        const buffer = await readFile(abs);
        const truncated = (opts?.maxBytes ?? 0) > 0 && buffer.length > (opts?.maxBytes ?? 0);
        const contentBuffer = truncated ? buffer.subarray(0, opts?.maxBytes) : buffer;
        return {
          success: true as const,
          data: {
            path: requestedPath,
            content: contentBuffer.toString('utf8'),
            encoding: 'utf-8' as const,
            size: buffer.length,
            truncated,
          },
        };
      } catch (e) {
        return {
          success: false as const,
          error: {
            code: 'PATH_NOT_FOUND' as const,
            message: String(e instanceof Error ? e.message : e),
          },
        };
      }
    },
  };
}

function makeContext(dir: string): ResolutionContext {
  return {
    workspaceRoot: dir,
    resolvePath: (rel) => resolve(dir, rel),
  };
}

test('FileReferenceResolver: resolves existing file content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mentions-file-'));
  await writeFile(join(dir, 'utils.ts'), 'export const x = 1;');
  try {
    const resolver = new FileReferenceResolver(makeConsumer(dir));
    const ref = await resolver.resolve('utils.ts', makeContext(dir));

    assert.equal(ref.error, undefined);
    assert.equal(ref.name, 'file:utils.ts');
    assert.deepEqual(ref.value, {
      path: join(dir, 'utils.ts'),
      content: 'export const x = 1;',
      size: 19,
      truncated: false,
    });
    assert.ok(ref.modelDescription?.includes('Content of utils.ts:'));
    assert.ok(ref.modelDescription?.includes('```'));
    assert.equal(ref.tool, 'read_file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FileReferenceResolver: truncates content based on token budget', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mentions-trunc-'));
  await writeFile(join(dir, 'big.txt'), 'a'.repeat(1000));
  try {
    const context = makeContext(dir);
    context.tokenBudget = 10;
    const resolver = new FileReferenceResolver(makeConsumer(dir));
    const ref = await resolver.resolve('big.txt', context);

    assert.equal(ref.error, undefined);
    const value = ref.value as { content: string; truncated: boolean };
    assert.equal(value.truncated, true);
    assert.equal(value.content.length, 40);
    assert.ok(ref.modelDescription?.includes('[truncated]'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FileReferenceResolver: missing file returns error flag', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mentions-missing-'));
  try {
    const resolver = new FileReferenceResolver(makeConsumer(dir));
    const ref = await resolver.resolve('nope.ts', makeContext(dir));

    assert.ok(ref.error, 'expected an error flag');
    assert.equal(ref.value, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FileReferenceResolver: empty args returns error flag', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mentions-empty-'));
  try {
    const resolver = new FileReferenceResolver(makeConsumer(dir));
    const ref = await resolver.resolve('   ', makeContext(dir));
    assert.ok(ref.error, 'expected an error flag');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FileReferenceResolver: aborted signal short-circuits resolution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mentions-abort-'));
  try {
    const context = makeContext(dir);
    const controller = new AbortController();
    controller.abort();
    context.signal = controller.signal;

    const resolver = new FileReferenceResolver(makeConsumer(dir));
    const ref = await resolver.resolve('utils.ts', context);

    assert.ok(ref.error, 'expected an error flag');
    assert.equal(ref.error?.message, 'Reference resolution aborted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
