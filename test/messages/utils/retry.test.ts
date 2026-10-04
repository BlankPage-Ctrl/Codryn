import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBusyError, withBusyRetry } from '../../../src/messages/utils/retry.js';

const busy = () => ({ code: 'SQLITE_BUSY', message: 'SQLITE_BUSY: database is locked' });

test('isBusyError detects direct, wrapped, and message-only busy failures', () => {
  assert.equal(isBusyError(busy()), true);
  assert.equal(isBusyError({ details: { cause: busy() } }), true);
  assert.equal(isBusyError(new Error('SQLITE_BUSY: cannot commit transaction')), true);
  assert.equal(isBusyError(new Error('boom')), false);
  assert.equal(isBusyError(null), false);
  assert.equal(isBusyError({ code: 'SQLITE_IOERR' }), false);
});

test('withBusyRetry succeeds after transient busy failures', async () => {
  let calls = 0;
  const result = await withBusyRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw busy();
      return 'ok';
    },
    { baseDelayMs: 1 },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withBusyRetry rethrows non-busy errors immediately', async () => {
  let calls = 0;
  await assert.rejects(
    withBusyRetry(
      async () => {
        calls += 1;
        throw new Error('boom');
      },
      { baseDelayMs: 1 },
    ),
    /boom/,
  );
  assert.equal(calls, 1);
});

test('withBusyRetry gives up after the configured attempts', async () => {
  let calls = 0;
  await assert.rejects(
    withBusyRetry(
      async (): Promise<string> => {
        calls += 1;
        throw busy();
      },
      { attempts: 3, baseDelayMs: 1 },
    ),
    (err: unknown) => isBusyError(err),
  );
  assert.equal(calls, 3);
});
