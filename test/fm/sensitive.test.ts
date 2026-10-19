import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SensitiveMatcher } from '../../src/fm/index.js';
import { SENSITIVE_FILE_PATTERNS } from '../../apps/shared/fm-permission.js';
function matcher(): SensitiveMatcher {
  return new SensitiveMatcher([...SENSITIVE_FILE_PATTERNS]);
}

test('sensitive: env files match, templates are allowed', () => {
  const m = matcher();
  assert.equal(m.isSensitive('/repo/.env'), true);
  assert.equal(m.isSensitive('/repo/.env.local'), true);
  assert.equal(m.isSensitive('/repo/.env.production'), true);
  assert.equal(m.isSensitive('/repo/.env.example'), false);
  assert.equal(m.isSensitive('/repo/.env.sample'), false);
  assert.equal(m.isSensitive('/repo/.env.template'), false);
  assert.equal(m.isSensitive('/repo/.env.dist'), false);
});

test('sensitive: key material and credential names', () => {
  const m = matcher();
  assert.equal(m.isSensitive('/repo/certs/server.pem'), true);
  assert.equal(m.isSensitive('/repo/certs/server.key'), true);
  assert.equal(m.isSensitive('/home/u/.ssh/id_rsa'), true);
  assert.equal(m.isSensitive('/home/u/.ssh/id_ed25519'), true);
  assert.equal(m.isSensitive('/home/u/.aws/credentials'), true);
  assert.equal(m.isSensitive('/home/u/.gnupg/secring.gpg'), true);
  assert.equal(m.isSensitive('/repo/store.p12'), true);
  assert.equal(m.isSensitive('/repo/app.keystore'), true);
});

test('sensitive: ordinary project files are not matched', () => {
  const m = matcher();
  assert.equal(m.isSensitive('/repo/src/app.ts'), false);
  assert.equal(m.isSensitive('/repo/src/environment.ts'), false);
  assert.equal(m.isSensitive('/repo/README.md'), false);
  assert.equal(m.isSensitive('/repo/src/keys.ts'), false);
});

test('sensitive: matching is case-insensitive and handles Windows separators', () => {
  const m = matcher();
  assert.equal(m.isSensitive('/repo/.ENV'), true);
  assert.equal(m.isSensitive('C:\\Users\\me\\.SSH\\ID_RSA'), true);
  assert.equal(m.isSensitive('C:\\Users\\me\\project\\.env.local'), true);
});

test('sensitive: empty pattern list disables the gate', () => {
  const m = new SensitiveMatcher([]);
  assert.equal(m.isSensitive('/repo/.env'), false);
});

test('sensitive: last matching rule wins', () => {
  const m = new SensitiveMatcher(['*.secret', '!public.secret']);
  assert.equal(m.isSensitive('/repo/private.secret'), true);
  assert.equal(m.isSensitive('/repo/public.secret'), false);
});
