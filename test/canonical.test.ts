import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildCanonicalString } from '../src/auth/engines/canonical.js';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

test('buildCanonicalString matches the Go signer contract', () => {
  const bodyHash = sha256Hex('');

  const out = buildCanonicalString({
    method: 'get',
    path: '/workspaces',
    queryString: 'id=abc12&limit=5&search=note',
    timestamp: '1234567890',
    requestId: 'req-test12345678',
    bodyHash,
  });

  assert.equal(
    out,
    [
      'GET',
      '/workspaces',
      'id=abc12&limit=5&search=note',
      '1234567890',
      'req-test12345678',
      bodyHash,
    ].join('\n'),
  );
});

test('buildCanonicalString sorts and joins query params with &', () => {
  const bodyHash = sha256Hex('');

  const out = buildCanonicalString({
    method: 'GET',
    path: '/notes',
    queryString: 'z=9&a=1&m=4',
    timestamp: '1234567890',
    requestId: 'req-x',
    bodyHash,
  });

  assert.ok(
    out.startsWith('GET\n/notes\na=1&m=4&z=9\n1234567890\nreq-x\n'),
    `unexpected canonical: ${out}`,
  );
});
