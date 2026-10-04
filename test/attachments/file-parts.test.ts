import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findFilePartIssues } from '../../apps/validators/attachment.js';
import { SendMessageSchema } from '../../apps/validators/message.js';
import { MAX_FILES_PER_MESSAGE } from '../../src/attachments/index.js';

const REF = 'attachment://123e4567-e89b-12d3-a456-426614174000';

test('valid attachment refs and data-URLs pass', () => {
  assert.deepEqual(
    findFilePartIssues([
      { type: 'text', text: 'hi' },
      { type: 'file', mediaType: 'image/png', url: REF },
      { type: 'file', mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,/9j/' },
    ]),
    [],
  );
});

test('non-image media types are rejected', () => {
  const issues = findFilePartIssues([
    { type: 'file', mediaType: 'application/pdf', url: REF },
  ]);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /mediaType/);
});

test('malformed refs, remote URLs, and missing urls are rejected', () => {
  assert.ok(findFilePartIssues([{ type: 'file', mediaType: 'image/png', url: 'attachment://nope' }]).length > 0);
  assert.ok(
    findFilePartIssues([{ type: 'file', mediaType: 'image/png', url: 'https://evil.example/x.png' }])
      .length > 0,
  );
  assert.ok(findFilePartIssues([{ type: 'file', mediaType: 'image/png' }]).length > 0);
});

test('oversized inline data-URLs are rejected', () => {
  const huge = `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}`;
  const issues = findFilePartIssues([{ type: 'file', mediaType: 'image/png', url: huge }]);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /upload via attachments/);
});

test('file count per message is capped', () => {
  const parts = Array.from({ length: MAX_FILES_PER_MESSAGE + 1 }, () => ({
    type: 'file',
    mediaType: 'image/png',
    url: REF,
  }));
  const issues = findFilePartIssues(parts);
  assert.ok(issues.some((i) => i.message.includes('at most')));
});

test('non-file parts pass through untouched', () => {
  assert.deepEqual(findFilePartIssues([{ type: 'tool-foo', toolCallId: 'x' }]), []);
});

test('SendMessageSchema accepts text and rejects bad file parts', () => {
  const ok = SendMessageSchema.parse({
    message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  });
  assert.equal(ok.message.id, 'm1');
  assert.throws(
    () =>
      SendMessageSchema.parse({
        message: {
          id: 'm1',
          role: 'user',
          parts: [{ type: 'file', mediaType: 'video/mp4', url: 'https://x/y.mp4' }],
        },
      }),
    /mediaType|file url/,
  );
});
