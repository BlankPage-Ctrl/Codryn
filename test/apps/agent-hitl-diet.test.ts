import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asSchema } from 'ai';
import { hitlToolSchema } from '../../apps/agent/tools/hitl.js';

// Guards the request_human token diet: the JSON schema actually sent to the
// model must stay small. Field removals would break the HITL API, so the
// diet is describe-text only - this threshold catches silent re-bloat.
test('hitl diet: request_human JSON schema stays under 4KB', async () => {
  const jsonSchema = await asSchema(hitlToolSchema).jsonSchema;
  const text = JSON.stringify(jsonSchema);
  assert.ok(
    text.length < 4_000,
    `request_human schema re-bloated: ${text.length} chars (budget 4000)`,
  );
  for (const key of ['"kind"', '"title"', '"options"', '"approval"', '"ask"', '"choice"']) {
    assert.ok(text.includes(key), `schema lost expected key ${key}`);
  }
});

test('hitl diet: validation behavior unchanged (fields intact)', () => {
  const okAsk = hitlToolSchema.safeParse({
    kind: 'ask',
    title: 'Proceed?',
    chatId: 'c1',
  });
  assert.equal(okAsk.success, true);
  const okChoice = hitlToolSchema.safeParse({
    kind: 'choice',
    title: 'Pick',
    chatId: 'c1',
    options: ['Yes', 'No'],
  });
  assert.equal(okChoice.success, true);
  const bad = hitlToolSchema.safeParse({ kind: 'ask', chatId: 'c1' });
  assert.equal(bad.success, false);
});
