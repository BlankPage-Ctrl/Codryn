import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAppLogger } from '../apps/shared/logging/app-logger.js';
import { redact, toTelemetrySafe, markSensitive } from '../apps/shared/logging/sensitive.js';
import { toLoggableError } from '../apps/shared/logging/serialize-error.js';
import { NoopTelemetry, HttpTelemetrySink } from '../apps/shared/logging/telemetry.js';
import type { TelemetryEvent } from '../apps/shared/logging/telemetry.js';

async function waitFor(pred: () => Promise<boolean>, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting for log file');
}

// --- serialize-error: full fidelity, not "Error: msg" only ---

test('logging: toLoggableError keeps stack + cause chain + system fields', () => {
  const cause = Object.assign(new Error('root cause'), { code: 'E_CONN' });
  const err = Object.assign(new Error('top failed'), {
    code: 'APP_FAIL',
    errno: -111,
    syscall: 'connect',
    cause,
  });
  const out = toLoggableError(err) as Record<string, unknown>;
  assert.equal(out['name'], 'Error');
  assert.equal(out['message'], 'top failed');
  assert.equal(out['code'], 'APP_FAIL');
  assert.equal(out['errno'], -111);
  assert.equal(out['syscall'], 'connect');
  assert.ok(typeof out['stack'] === 'string' && (out['stack'] as string).includes('top failed'));
  const c = out['cause'] as Record<string, unknown>;
  assert.equal(c['message'], 'root cause');
  assert.equal(c['code'], 'E_CONN');
  assert.ok(typeof (out['proc'] as Record<string, unknown>)['pid'] === 'number');
});

test('logging: toLoggableError handles AggregateError.errors[]', () => {
  const agg = new AggregateError([new Error('a'), new Error('b')], 'many failed');
  const out = toLoggableError(agg) as Record<string, unknown>;
  assert.ok(Array.isArray(out['errors']));
  assert.equal((out['errors'] as unknown[]).length, 2);
});

// --- sensitive: redact locally, drop from telemetry ---

test('logging: redact replaces secret keys and reports them', () => {
  const { value, redactedKeys } = redact({
    name: 'x',
    secretKey: 's3cr3t',
    nested: { apiKey: 'k', ok: 1 },
  });
  const v = value as Record<string, unknown>;
  assert.equal(v['secretKey'], '[REDACTED]');
  assert.equal((v['nested'] as Record<string, unknown>)['apiKey'], '[REDACTED]');
  assert.equal((v['nested'] as Record<string, unknown>)['ok'], 1);
  assert.ok(redactedKeys.includes('secretKey'));
  assert.ok(redactedKeys.includes('apiKey'));
});

test('logging: sensitive:true records are dropped from telemetry payload', () => {
  const r = toTelemetrySafe({ sensitive: true, secretKey: 's3cr3t', msg: 'hi' });
  assert.equal(r.drop, true);
  const ok = toTelemetrySafe({ msg: 'hello', token: 'abc' });
  assert.equal(ok.drop, false);
  assert.equal((ok.payload as Record<string, unknown>)['token'], '[REDACTED]');
});

test('logging: markSensitive object is dropped from telemetry', () => {
  const obj = markSensitive({ msg: 'contains creds' });
  assert.equal(toTelemetrySafe(obj).drop, true);
});

// --- app logger: dual file output ---

test('logging: createAppLogger writes app.jsonl + app.log with redaction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-log-'));
  const created = createAppLogger({
    name: 'test',
    transport: 'cli',
    basePath: dir,
    logging: {
      level: 'debug',
      dir: join(dir, 'logs'),
      maxSizeMb: 10,
      maxFiles: 3,
      consoleEnabled: false,
    },
  });
  created.logger.info({ hello: 'world' }, 'plain message');
  created.logger.error({ err: new Error('boom'), secretKey: 's3cr3t' }, 'failed op');
  created.logger.info({ sensitive: true, token: 'tok-123' }, 'local only note');
  await created.flush();
  await created.close();

  const logDir = join(dir, 'logs');
  const jsonlRaw = await readFile(join(logDir, 'app.jsonl'), 'utf8');
  const humanRaw = await readFile(join(logDir, 'app.log'), 'utf8');
  const lines = jsonlRaw.split('\n').filter((l) => l.trim() !== '');
  assert.ok(lines.length >= 4, `expected >=4 jsonl lines, got ${lines.length}`);
  for (const line of lines) {
    JSON.parse(line); // every line must be valid JSON (telemetry-ready)
  }
  assert.ok(!jsonlRaw.includes('s3cr3t'), 'raw secret must not hit disk');
  assert.ok(!jsonlRaw.includes('tok-123'), 'sensitive token must not hit disk');
  assert.ok(jsonlRaw.includes('[REDACTED]'));
  assert.ok(humanRaw.includes('plain message'));
  assert.ok(humanRaw.includes('boom'));

  await rm(dir, { recursive: true, force: true });
});

test('logging: createAppLogger resolves dir from explicit logging.dir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-log-env-'));
  try {
    const created = createAppLogger({
      name: 't',
      transport: 'cli',
      logging: { dir: join(dir, 'custom'), consoleEnabled: false },
    });
    assert.equal(created.dir, join(dir, 'custom'));
    created.logger.info('hi');
    await waitFor(async () => {
      try {
        const raw = await readFile(join(created.dir, 'app.jsonl'), 'utf8');
        return raw.includes('hi');
      } catch {
        return false;
      }
    });
    await created.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- telemetry gate: sensitive records reach files but never the sink ---

test('logging: sensitive records are written to files but dropped from telemetry sink', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-log-gate-'));
  const events: TelemetryEvent[] = [];
  const spy = {
    emit: (e: TelemetryEvent) => {
      events.push(e);
    },
    flush: async () => {},
    close: async () => {},
  };
  const created = createAppLogger({
    name: 'gate',
    transport: 'cli',
    basePath: dir,
    logging: {
      level: 'debug',
      dir: join(dir, 'logs'),
      maxSizeMb: 10,
      maxFiles: 3,
      consoleEnabled: false,
    },
    telemetrySink: spy,
  });
  created.logger.info({ runId: 'r1', stepCount: 2 }, 'operational note');
  created.logger.error({ sensitive: true, cmd: 'export API_KEY=xxx', runId: 'r1' }, 'shell failed');
  await created.flush();
  await created.close();

  const logDir = join(dir, 'logs');
  const jsonlRaw = await readFile(join(logDir, 'app.jsonl'), 'utf8');
  assert.ok(jsonlRaw.includes('operational note'), 'normal record must reach the file');
  assert.ok(jsonlRaw.includes('shell failed'), 'sensitive record must still reach the LOCAL file');

  const msgs = events.map((e) => e.msg);
  assert.ok(msgs.includes('operational note'), 'normal record must reach telemetry sink');
  assert.ok(!msgs.includes('shell failed'), 'sensitive record must be DROPPED from telemetry');
  assert.ok(
    !JSON.stringify(events).includes('API_KEY=xxx'),
    'secret must not leak into telemetry payload',
  );

  await rm(dir, { recursive: true, force: true });
});

test('logging: permission-style warn carries sensitive flag end to end', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-log-perm-'));
  const events: TelemetryEvent[] = [];
  const created = createAppLogger({
    name: 'perm',
    transport: 'cli',
    basePath: dir,
    logging: {
      level: 'debug',
      dir: join(dir, 'logs'),
      maxSizeMb: 10,
      maxFiles: 3,
      consoleEnabled: false,
    },
    telemetrySink: {
      emit: (e: TelemetryEvent) => {
        events.push(e);
      },
      flush: async () => {},
      close: async () => {},
    },
  });
  // Mirrors apps/shared/shell-permission.ts shape.
  created.logger.warn(
    { sensitive: true, command: 'deploy --token abc', executionId: 'ex1' },
    '[shell-permission] HITL request failed, aborting shell',
  );
  await created.flush();
  await created.close();

  const jsonlRaw = await readFile(join(dir, 'logs', 'app.jsonl'), 'utf8');
  assert.ok(jsonlRaw.includes('aborting shell'), 'must be in local file');
  // Only the 'logger initialized' banner (non-sensitive) may reach the sink.
  assert.ok(
    events.every((e) => !e.msg.includes('aborting shell')),
    'sensitive permission log must not reach telemetry at all',
  );

  await rm(dir, { recursive: true, force: true });
});

// --- telemetry: provided, not wired ---

test('logging: NoopTelemetry never throws; HttpTelemetrySink batches without breaking app', async () => {
  const noop = new NoopTelemetry();
  noop.emit({ ts: '', level: 'info', logger: 't', msg: 'x', fields: {}, redactedKeys: [], pid: 1 });
  await noop.flush();
  await noop.close();

  const sink = new HttpTelemetrySink({
    endpoint: 'http://127.0.0.1:9/nope',
    flushIntervalMs: 60_000,
  });
  sink.emit({ ts: '', level: 'info', logger: 't', msg: 'x', fields: {}, redactedKeys: [], pid: 1 });
  await sink.close(); // must not throw even though endpoint is dead
});
