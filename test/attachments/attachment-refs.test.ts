import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UIMessage } from 'ai';
import {
  attachmentIdFromUrl,
  collectAttachmentIds,
  rewriteAttachmentUrls,
} from '../../apps/shared/attachment-refs.js';

const ID = '123e4567-e89b-12d3-a456-426614174000';

test('attachmentIdFromUrl parses refs only', () => {
  assert.equal(attachmentIdFromUrl(`attachment://${ID}`), ID);
  assert.equal(attachmentIdFromUrl('data:image/png;base64,AAA'), null);
  assert.equal(attachmentIdFromUrl('attachment://'), null);
  assert.equal(attachmentIdFromUrl('https://x/y.png'), null);
});

test('collectAttachmentIds dedupes across messages', () => {
  const messages = [
    {
      id: 'm1',
      role: 'user',
      parts: [
        { type: 'text', text: 'a' },
        { type: 'file', mediaType: 'image/png', url: `attachment://${ID}` },
      ],
    },
    {
      id: 'm2',
      role: 'user',
      parts: [{ type: 'file', mediaType: 'image/png', url: `attachment://${ID}` }],
    },
  ] as UIMessage[];
  assert.deepEqual(collectAttachmentIds(messages), [ID]);
});

test('rewriteAttachmentUrls is pure and surgical', () => {
  const dataUrl = 'data:image/png;base64,AAA';
  const messages = [
    {
      id: 'm1',
      role: 'user',
      parts: [
        { type: 'text', text: 'keep' },
        { type: 'file', mediaType: 'image/png', url: `attachment://${ID}` },
        { type: 'file', mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,BBB' },
      ],
    },
  ] as UIMessage[];
  const out = rewriteAttachmentUrls(messages, new Map([[ID, dataUrl]]));
  const parts = out[0].parts as Array<{ type: string; url?: string; text?: string }>;
  assert.equal(parts[1].url, dataUrl);
  assert.equal(parts[2].url, 'data:image/jpeg;base64,BBB');
  assert.equal(parts[0].text, 'keep');
  // input untouched - persisted copies keep the opaque ref
  assert.equal(
    (messages[0].parts[1] as { url: string }).url,
    `attachment://${ID}`,
  );
});

test('rewrite leaves unknown ids in place', () => {
  const messages = [
    {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'file', mediaType: 'image/png', url: `attachment://${ID}` }],
    },
  ] as UIMessage[];
  const out = rewriteAttachmentUrls(messages, new Map());
  assert.equal(out[0], messages[0]);
});
