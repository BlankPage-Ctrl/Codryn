import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreamRegistry } from '../../apps/stdio/streams.js';

test('StreamRegistry: register returns an abortable signal', () => {
  const registry = new StreamRegistry();
  const signal = registry.register('req-1');
  assert.equal(signal.aborted, false);
  registry.abort('req-1');
  assert.equal(signal.aborted, true);
});

test('StreamRegistry: abort unknown id is a no-op', () => {
  const registry = new StreamRegistry();
  assert.doesNotThrow(() => registry.abort('missing'));
});

test('StreamRegistry: unregister stops tracking', () => {
  const registry = new StreamRegistry();
  const signal = registry.register('req-1');
  registry.unregister('req-1');
  registry.abort('req-1');
  assert.equal(signal.aborted, false);
});

test('StreamRegistry: abortAll aborts every stream and clears', () => {
  const registry = new StreamRegistry();
  const a = registry.register('req-1');
  const b = registry.register('req-2');
  registry.abortAll();
  assert.equal(a.aborted, true);
  assert.equal(b.aborted, true);
  registry.abort('req-1');
  registry.abort('req-2');
});
