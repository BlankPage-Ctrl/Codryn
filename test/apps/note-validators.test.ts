import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateCreateNote,
  validateCreateCategory,
  validateRenameCategory,
  validateMoveNote,
} from '../../apps/validators/note.js';
import { noteMethods } from '../../apps/stdio/registry/note.js';

const validBody = { details: 'do the thing', name: 'My note', priority: 'high' };

test('validateCreateNote: accepts a body without workspace_id', () => {
  const parsed = validateCreateNote(validBody);
  assert.equal(parsed.details, 'do the thing');
  assert.equal(parsed.name, 'My note');
  assert.equal(parsed.priority, 'high');
  assert.equal('workspace_id' in parsed, false);
});

test('validateCreateNote: defaults the name', () => {
  assert.equal(validateCreateNote({ details: 'x' }).name, 'Untitled');
});

test('validateCreateNote: drops a workspace_id supplied by the client', () => {
  const parsed = validateCreateNote({ ...validBody, workspace_id: 'spoofed' });
  assert.equal('workspace_id' in parsed, false);
});

test('validateCreateNote: rejects both position.before and position.after', () => {
  assert.throws(
    () =>
      validateCreateNote({
        ...validBody,
        position: { before: 'a', after: 'b' },
      }),
    /mutually exclusive/,
  );
});

test('validateCreateNote: accepts a single position anchor', () => {
  const parsed = validateCreateNote({ ...validBody, position: { before: 'a' } });
  assert.deepEqual(parsed.position, { before: 'a' });
});

test('validateCreateNote: rejects a missing details field', () => {
  assert.throws(() => validateCreateNote({ name: 'no details' }));
});

test('validateCreateNote: strips unknown fields', () => {
  const parsed = validateCreateNote({ ...validBody, nope: 'x' });
  assert.equal('nope' in parsed, false);
});

test('validateCreateCategory: works without workspace_id', () => {
  const parsed = validateCreateCategory({ name: 'Work', color: '#a1b2c3' });
  assert.equal(parsed.name, 'Work');
  assert.equal('workspace_id' in parsed, false);
});

test('validateCreateCategory: rejects a bad color', () => {
  assert.throws(() => validateCreateCategory({ name: 'Work', color: 'red' }));
});

test('validateRenameCategory: rejects extra keys', () => {
  assert.throws(() => validateRenameCategory({ name: 'Work', extra: 1 }));
});

test('validateMoveNote: requires exactly one anchor', () => {
  assert.throws(() => validateMoveNote({}));
  assert.throws(() => validateMoveNote({ before: 'a', after: 'b' }));
  assert.deepEqual(validateMoveNote({ after: 'b' }), { after: 'b' });
});

test('stdio create.note: validates the same body as the HTTP route', () => {
  const method = noteMethods['create.note'];
  assert.ok(method, 'create.note method is registered');

  // The mutual-exclusion rule used to be dropped by .merge()/.omit().
  assert.throws(
    () =>
      method.validate({
        workspaceId: 'ws-1',
        ...validBody,
        position: { before: 'a', after: 'b' },
      }),
    /mutually exclusive/,
  );

  const ok = method.validate({ workspaceId: 'ws-1', ...validBody }) as Record<string, unknown>;
  assert.equal(ok.workspaceId, 'ws-1');
  assert.equal(ok.details, 'do the thing');
  assert.equal('workspace_id' in ok, false);
});
