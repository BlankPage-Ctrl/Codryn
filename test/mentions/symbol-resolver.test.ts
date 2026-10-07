import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SymbolReferenceResolver,
  type SymbolTarget,
} from '../../apps/shared/mentions/resolver/symbol.js';
import type { ResolutionContext } from '../../src/mentions/types/reference.js';

const TARGET: SymbolTarget = {
  id: 'sym-1',
  name: 'greet',
  qualifiedName: 'main.greet',
  kind: 'function',
  filePath: 'main.go',
  startLine: 10,
  endLine: 14,
};

function makeConsumer(lines: string[], target: SymbolTarget = TARGET) {
  return {
    lookup: async (id: string) => {
      if (id !== target.id) throw new Error(`Symbol not found: ${id}`);
      return target;
    },
    readFile: async (requestedPath: string, opts?: { startLine?: number; endLine?: number }) => {
      assert.equal(requestedPath, target.filePath);
      const start = (opts?.startLine ?? 1) - 1;
      const end = opts?.endLine ?? lines.length;
      return {
        success: true as const,
        data: {
          path: requestedPath,
          content: lines.slice(start, end).join('\n'),
          encoding: 'utf-8' as const,
          size: 120,
          truncated: false,
          totalLines: lines.length,
        },
      };
    },
  };
}

function makeContext(): ResolutionContext {
  return {
    workspaceRoot: '/ws',
    resolvePath: (rel) => `/ws/${rel}`,
  };
}

const LINES = [
  'package main',
  '',
  '// greet writes a greeting.',
  'func greet() {',
  'println("hi")',
  '}',
  '',
  'func main() {}',
  'println("x")',
  'println("y")',
  'println("z")',
  'println("w")',
  'println("v")',
  'println("u")',
];

test('SymbolReferenceResolver: resolves snippet range by id', async () => {
  const resolver = new SymbolReferenceResolver(makeConsumer(LINES));
  const ref = await resolver.resolve('sym-1', makeContext());

  assert.equal(ref.error, undefined);
  assert.equal(ref.name, 'symbol:sym-1');
  assert.deepEqual(ref.value, {
    id: 'sym-1',
    name: 'greet',
    kind: 'function',
    filePath: 'main.go',
    lineRange: { start: 10, end: 14 },
    truncated: false,
  });
  assert.ok(ref.modelDescription?.includes('Symbol main.greet (function) in main.go:10-14:'));
  assert.ok(ref.modelDescription?.includes('```go'));
  assert.equal(ref.tool, 'read_file');
});

test('SymbolReferenceResolver: unknown id returns error flag', async () => {
  const resolver = new SymbolReferenceResolver(makeConsumer(LINES));
  const ref = await resolver.resolve('nope', makeContext());

  assert.ok(ref.error, 'expected an error flag');
  assert.ok(ref.error?.message.includes('Symbol not found'));
  assert.equal(ref.value, null);
});

test('SymbolReferenceResolver: empty args returns error flag', async () => {
  const resolver = new SymbolReferenceResolver(makeConsumer(LINES));
  const ref = await resolver.resolve('   ', makeContext());
  assert.ok(ref.error, 'expected an error flag');
});

test('SymbolReferenceResolver: aborted signal short-circuits resolution', async () => {
  const context = makeContext();
  const controller = new AbortController();
  controller.abort();
  context.signal = controller.signal;

  const resolver = new SymbolReferenceResolver(makeConsumer(LINES));
  const ref = await resolver.resolve('sym-1', context);

  assert.ok(ref.error, 'expected an error flag');
  assert.equal(ref.error?.message, 'Reference resolution aborted');
});
