import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HitlRequestInputSchema,
  ApprovalResponseSchema,
  makeAskResponseSchema,
  makeChoiceResponseSchema,
  ChoicePayloadSchema,
} from '../../src/human-in-the-loop/index.js';

test('HitlRequestInputSchema: accepts a minimal approval request', () => {
  const r = HitlRequestInputSchema.parse({
    type: 'approval',
    title: 'Deploy to prod?',
    chatId: 'chat-1',
    executionId: 'exec-1',
    payload: { contextPreview: { env: 'prod' } },
  });
  assert.equal(r.type, 'approval');
  assert.deepEqual((r.payload as { contextPreview: unknown }).contextPreview, { env: 'prod' });
});

test('HitlRequestInputSchema: choice requires a payload', () => {
  assert.throws(() =>
    HitlRequestInputSchema.parse({
      type: 'choice',
      title: 'Strategy?',
      chatId: 'chat-1',
      executionId: 'exec-1',
    }),
  );
});

test('HitlRequestInputSchema: rejects unknown type', () => {
  assert.throws(() =>
    HitlRequestInputSchema.parse({
      type: 'confirm',
      title: 'x',
      chatId: 'chat-1',
      executionId: 'exec-1',
    }),
  );
});

test('HitlRequestInputSchema: defaults metadata to empty object', () => {
  const r = HitlRequestInputSchema.parse({
    type: 'ask',
    title: 'Budget?',
    chatId: 'chat-1',
    executionId: 'exec-1',
  });
  assert.deepEqual(r.metadata, {});
});

test('ApprovalResponseSchema: approved_with_modification requires modificationNote', () => {
  assert.throws(() => ApprovalResponseSchema.parse({ outcome: 'approved_with_modification' }));
  const ok = ApprovalResponseSchema.parse({
    outcome: 'approved_with_modification',
    modificationNote: 'use 4.5jt',
  });
  assert.equal(ok.modificationNote, 'use 4.5jt');
});

test('ApprovalResponseSchema: plain reject must not carry modificationNote', () => {
  assert.throws(() =>
    ApprovalResponseSchema.parse({
      outcome: 'rejected',
      modificationNote: 'nope',
    }),
  );
});

test('makeAskResponseSchema: enforces length + regex', () => {
  const schema = makeAskResponseSchema({
    minLength: 3,
    maxLength: 10,
    validationRegex: '^\\d+$',
  });
  assert.throws(() => schema.parse({ value: 'ab' })); // too short
  assert.throws(() => schema.parse({ value: '12345678901' })); // too long
  assert.throws(() => schema.parse({ value: 'abc' })); // fails regex
  assert.deepEqual(schema.parse({ value: '12345' }), { value: '12345' });
});

test('makeChoiceResponseSchema: single requires exactly one', () => {
  const schema = makeChoiceResponseSchema({
    mode: 'single',
    optionIds: ['a', 'b'],
  });
  assert.throws(() => schema.parse({ selected: ['a', 'b'] }));
  assert.throws(() => schema.parse({ selected: [] }));
  assert.deepEqual(schema.parse({ selected: ['a'] }).selected, ['a']);
});

test('makeChoiceResponseSchema: multi respects min/max', () => {
  const schema = makeChoiceResponseSchema({
    mode: 'multi',
    optionIds: ['a', 'b', 'c'],
    minSelect: 2,
    maxSelect: 2,
  });
  assert.throws(() => schema.parse({ selected: ['a'] })); // below min
  assert.throws(() => schema.parse({ selected: ['a', 'b', 'c'] })); // above max
  assert.deepEqual(schema.parse({ selected: ['a', 'b'] }).selected, ['a', 'b']);
});

test('makeChoiceResponseSchema: allowOther accepts customInput alongside a selection', () => {
  const schema = makeChoiceResponseSchema({
    mode: 'single',
    optionIds: ['a', 'other'],
    allowOther: true,
  });
  assert.deepEqual(
    schema.parse({ selected: ['other'], customInput: 'something else' }).customInput,
    'something else',
  );
});

test('ChoicePayloadSchema: ranked mode with recommendation flag', () => {
  const p = ChoicePayloadSchema.parse({
    mode: 'ranked',
    options: [
      { id: 'a', title: 'A', recommended: true },
      { id: 'b', title: 'B' },
    ],
  });
  assert.equal(p.mode, 'ranked');
  assert.equal(p.options[0].recommended, true);
});
