import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerAuthMiddleware } from '../../apps/http/middleware/auth.js';
import { ClientService, DefaultClientStore } from '../../src/auth/index.js';

// Regression test: Go's json.Marshal escapes <>& as \u003c etc and sorts
// map keys, while JS JSON.stringify does neither. The auth middleware must
// verify the exact wire bytes (req.rawBody, set by the content-type parser
// in apps/http/factory.ts) - re-stringifying req.body produces different
// bytes for payloads containing HTML chars and caused spurious 401s.

const CLIENT_ID = 'default-client';
const SECRET = 'test-secret-for-auth-rawbody';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function signGoStyle(args: {
  method: string;
  path: string;
  queryString: string;
  timestamp: string;
  requestId: string;
  wireBody: string;
}): string {
  const bodyHash = sha256Hex(args.wireBody);
  const canonical = [
    args.method.toUpperCase(),
    args.path,
    args.queryString,
    args.timestamp,
    args.requestId,
    bodyHash,
  ].join('\n');
  const stringToSign = ['HMAC-SHA256', sha256Hex(canonical)].join('\n');
  return `HMAC-SHA256=${createHmac('sha256', SECRET).update(stringToSign, 'utf8').digest('hex')}`;
}

// Mimics Go: json.Unmarshal(frontend JSON) then json.Marshal (sorted keys,
// HTML-escaped). Key order here is hand-sorted to match Go map marshaling.
function goWireBody(): string {
  return (
    '{"message":{"id":"msg-1","parts":[{"text":"hello \\u003cdetails\\u003e' +
    '\\u003csummary\\u003etest\\u003c/summary\\u003e a \\u0026 b","type":"text"}],"role":"user"}}'
  );
}

function makeApp() {
  const app = Fastify({ logger: false });
  // Same parser contract as apps/http/factory.ts (sets req.rawBody).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const raw = body.toString('utf8');
    (req as { rawBody?: string }).rawBody = raw;
    if (body.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error);
    }
  });
  const store = new DefaultClientStore({ clientId: CLIENT_ID, secretKey: SECRET });
  const clientService = new ClientService({} as never, store);
  registerAuthMiddleware(app, { clientService } as never);
  app.post('/workspaces/:workspaceId/chats/:chatId/runs', async () => ({ ok: true }));
  return app;
}

test('auth accepts Go-escaped payload with <>& when verifying raw wire bytes', async () => {
  const app = makeApp();
  const wire = goWireBody();

  // Document the trap: re-stringifying the parsed body is NOT byte-identical.
  assert.notEqual(JSON.stringify(JSON.parse(wire)), wire);

  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = 'req-test12345678';
  const path = '/workspaces/ws-1/chats/chat-1/runs';
  const signature = signGoStyle({
    method: 'POST',
    path,
    queryString: '',
    timestamp,
    requestId,
    wireBody: wire,
  });

  const res = await app.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/json',
      'x-client-id': CLIENT_ID,
      'x-signature': signature,
      'x-timestamp': timestamp,
      'x-request-id': requestId,
    },
    payload: wire,
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"ok":true/);
  await app.close();
});

test('auth still rejects tampered bodies', async () => {
  const app = makeApp();
  const wire = goWireBody();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = 'req-test12345678';
  const path = '/workspaces/ws-1/chats/chat-1/runs';
  const signature = signGoStyle({
    method: 'POST',
    path,
    queryString: '',
    timestamp,
    requestId,
    wireBody: wire,
  });

  const tampered = wire.replace('hello', 'hacked');
  const res = await app.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/json',
      'x-client-id': CLIENT_ID,
      'x-signature': signature,
      'x-timestamp': timestamp,
      'x-request-id': requestId,
    },
    payload: tampered,
  });

  assert.equal(res.statusCode, 401);
  await app.close();
});
