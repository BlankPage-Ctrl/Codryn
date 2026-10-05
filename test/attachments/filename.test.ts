import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extensionForMediaType, sanitizeFilename } from '../../src/attachments/utils/filename.js';

test('sanitize keeps readable names but strips danger', () => {
  assert.equal(sanitizeFilename('screenshot 1.png'), 'screenshot_1.png');
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('a/b\\c.png'), 'c.png');
  assert.equal(sanitizeFilename('C:\\fakepath\\photo.png'), 'photo.png');
  assert.equal(sanitizeFilename('foto!!!keren###.jpg'), 'foto_keren_.jpg');
});

test('sanitize falls back when nothing usable remains', () => {
  assert.equal(sanitizeFilename('...'), 'image');
  assert.equal(sanitizeFilename(''), 'image');
  assert.equal(sanitizeFilename('   '), 'image');
});

test('sanitize truncates long names', () => {
  const out = sanitizeFilename(`${'a'.repeat(200)}.png`);
  assert.ok(out.length <= 100);
  assert.ok(out.endsWith('.png'));
});

test('extension mapping covers supported types', () => {
  assert.equal(extensionForMediaType('image/png'), 'png');
  assert.equal(extensionForMediaType('image/jpeg'), 'jpg');
  assert.equal(extensionForMediaType('image/webp'), 'webp');
  assert.equal(extensionForMediaType('image/gif'), 'gif');
  assert.equal(extensionForMediaType('application/pdf'), 'bin');
});
