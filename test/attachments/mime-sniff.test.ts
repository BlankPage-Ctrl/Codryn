import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sniffImageMediaType } from '../../src/attachments/engines/sniff.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF89 = Buffer.from('GIF89a' + '\x01\x00', 'binary');
const GIF87 = Buffer.from('GIF87a' + '\x01\x00', 'binary');
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

test('sniff detects supported image formats', () => {
  assert.equal(sniffImageMediaType(PNG), 'image/png');
  assert.equal(sniffImageMediaType(JPEG), 'image/jpeg');
  assert.equal(sniffImageMediaType(GIF89), 'image/gif');
  assert.equal(sniffImageMediaType(GIF87), 'image/gif');
  assert.equal(sniffImageMediaType(WEBP), 'image/webp');
});

test('sniff rejects non-images and truncated input', () => {
  assert.equal(sniffImageMediaType(Buffer.from('%PDF-1.4 fake')), null);
  assert.equal(sniffImageMediaType(Buffer.from('hello world, not an image at all')), null);
  assert.equal(sniffImageMediaType(Buffer.alloc(0)), null);
  assert.equal(sniffImageMediaType(Buffer.from([0x89, 0x50])), null);
  // RIFF without WEBP marker is not webp
  assert.equal(
    sniffImageMediaType(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])),
    null,
  );
});

test('sniff does not confuse JPEG with PNG', () => {
  assert.notEqual(sniffImageMediaType(JPEG), 'image/png');
});
