import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BACKEND_NAME,
  DEV_VERSION,
  getVersion,
  getVersionInfo,
  normalizeTag,
  resetVersionCacheForTest,
  resolveVersion,
} from '../../apps/shared/version.js';

test('normalizeTag: strips leading v and keeps semver', () => {
  assert.equal(normalizeTag('v1.2.3'), '1.2.3');
  assert.equal(normalizeTag('V0.0.10'), '0.0.10');
  assert.equal(normalizeTag('1.2.3'), '1.2.3');
  assert.equal(normalizeTag('  v2.0.0-rc.1  '), '2.0.0-rc.1');
});

test('normalizeTag: rejects empty and non-semver input', () => {
  assert.equal(normalizeTag(undefined), null);
  assert.equal(normalizeTag(null), null);
  assert.equal(normalizeTag(''), null);
  assert.equal(normalizeTag('   '), null);
  assert.equal(normalizeTag('main'), null);
  assert.equal(normalizeTag('v1.2'), null);
  assert.equal(normalizeTag('release-1'), null);
});

test('getVersion: CODRYN_VERSION wins over APP_VERSION', () => {
  resetVersionCacheForTest();
  assert.equal(getVersion({ CODRYN_VERSION: 'v1.2.3', APP_VERSION: '9.9.9' }), '1.2.3');
});

test('getVersion: falls back to APP_VERSION when CODRYN_VERSION is absent', () => {
  resetVersionCacheForTest();
  assert.equal(getVersion({ APP_VERSION: 'v2.0.0' }), '2.0.0');
});

test('getVersion: ignores invalid env tags and falls through', () => {
  resetVersionCacheForTest();
  const version = getVersion({ CODRYN_VERSION: 'not-a-version', APP_VERSION: 'also-bad' });
  assert.ok(typeof version === 'string' && version.length > 0);
  assert.notEqual(version, 'not-a-version');
});

test('resolveVersion: tag beats package.json beats sha fallback', () => {
  assert.equal(resolveVersion({ tag: '1.2.3', packageJson: '9.9.9', sha: 'abc1234' }), '1.2.3');
  assert.equal(resolveVersion({ tag: null, packageJson: '9.9.9', sha: 'abc1234' }), '9.9.9');
  assert.equal(
    resolveVersion({ tag: null, packageJson: null, sha: 'abc1234' }),
    `${DEV_VERSION}+abc1234`,
  );
  assert.equal(resolveVersion({ tag: null, packageJson: null, sha: null }), DEV_VERSION);
});

test('getVersionInfo: reports name, version, sha, and raw tag', () => {
  resetVersionCacheForTest();
  const info = getVersionInfo({ CODRYN_VERSION: 'v1.4.0', GITHUB_SHA: 'deadbee1234' });
  assert.equal(info.name, BACKEND_NAME);
  assert.equal(info.version, '1.4.0');
  assert.equal(info.sha, 'deadbee');
  assert.equal(info.tag, 'v1.4.0');
  assert.equal(getVersionInfo({}).tag, null);
  assert.ok(DEV_VERSION.startsWith('0.0.0-dev'));
});
