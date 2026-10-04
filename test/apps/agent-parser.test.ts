import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEditsAtomic } from '../../src/fm/index.js';
import { MAX_EDIT_BLOCKS, ParseEditError, parseEditInput } from '../../apps/agent/utils/parser.js';

const USER_EXAMPLE = `src/auth/middleware.py
<<<<<<< SEARCH lines 19 (hint)
    if not validate_token(token):
=======
    log_request(request)
    if not validate_token(token):
>>>>>>> REPLACE


<<<<<<< SEARCH lines 13-14 (hint)
    if not validate_token(old_token):
        raise ValueError("Invalid token")
=======
    if not validate_token(old_token):
        raise AuthenticationError("Token validation failed")
>>>>>>> REPLACE


<<<<<<< SEARCH lines 8-9 (hint)
    payload = decode_jwt(token)
    return payload.get("exp", 0) > datetime.now().timestamp()
=======
    try:
        payload = decode_jwt(token)
        return payload.get("exp", 0) > datetime.now().timestamp()
    except Exception:
        return False
>>>>>>> REPLACE
`;

test('parser: exact user example yields path + 3 edits with hints', () => {
  const out = parseEditInput(USER_EXAMPLE);
  assert.equal(out.path, 'src/auth/middleware.py');
  assert.equal(out.apply_order, 'reverse');
  assert.equal(out.edits.length, 3);
  assert.deepEqual(out.edits[0]?.hint, { startLine: 19, endLine: 19 });
  assert.deepEqual(out.edits[1]?.hint, { startLine: 13, endLine: 14 });
  assert.deepEqual(out.edits[2]?.hint, { startLine: 8, endLine: 9 });
  assert.equal(out.edits[0]?.search, '    if not validate_token(token):');
  assert.equal(
    out.edits[0]?.replace,
    '    log_request(request)\n    if not validate_token(token):',
  );
  assert.ok(out.edits[1]?.replace.includes('AuthenticationError'));
  assert.ok(out.edits[2]?.replace.includes('except Exception:'));
});

test('parser: plain SEARCH header without hint is allowed', () => {
  const out = parseEditInput('a.txt\n<<<<<<< SEARCH\nhello\n=======\nhi\n>>>>>>> REPLACE\n');
  assert.equal(out.path, 'a.txt');
  assert.equal(out.edits.length, 1);
  assert.equal(out.edits[0]?.search, 'hello');
  assert.equal(out.edits[0]?.replace, 'hi');
  assert.equal(out.edits[0]?.hint, undefined);
});

test('parser: empty replace means delete', () => {
  const out = parseEditInput('a.txt\n<<<<<<< SEARCH lines 2\nbye\n=======\n>>>>>>> REPLACE\n');
  assert.equal(out.edits[0]?.replace, '');
});

test('parser: strips code fence and CRLF', () => {
  const fenced =
    '```text\r\nsrc/x.py\r\n<<<<<<< SEARCH\r\nfoo()\r\n=======\r\nbar()\r\n>>>>>>> REPLACE\r\n```';
  const out = parseEditInput(fenced);
  assert.equal(out.path, 'src/x.py');
  assert.equal(out.edits[0]?.search, 'foo()');
  assert.equal(out.edits[0]?.replace, 'bar()');
});

test('parser: strips backtick-wrapped path', () => {
  const out = parseEditInput('`src/x.py`\n<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE\n');
  assert.equal(out.path, 'src/x.py');
});

test('parser: round-trips into fm applyEditsAtomic', () => {
  const out = parseEditInput(USER_EXAMPLE);
  const before = [
    'line1',
    'line2',
    'line3',
    'line4',
    'line5',
    'line6',
    'line7',
    '    payload = decode_jwt(token)',
    '    return payload.get("exp", 0) > datetime.now().timestamp()',
    'line10',
    'line11',
    'line12',
    '    if not validate_token(old_token):',
    '        raise ValueError("Invalid token")',
    'line15',
    'line16',
    'line17',
    'line18',
    '    if not validate_token(token):',
    'line20',
  ].join('\n');
  const after = applyEditsAtomic(before, out.edits, out.apply_order);
  assert.ok(after.includes('log_request(request)'));
  assert.ok(after.includes('AuthenticationError("Token validation failed")'));
  assert.ok(after.includes('except Exception:'));
  assert.ok(!after.includes('raise ValueError("Invalid token")'));
});

function assertParseError(raw: string, snippet: string): ParseEditError {
  assert.throws(() => parseEditInput(raw), ParseEditError);
  try {
    parseEditInput(raw);
  } catch (err) {
    assert.ok(err instanceof ParseEditError);
    assert.ok(err.message.includes(snippet), `expected "${err.message}" to include "${snippet}"`);
    assert.equal(err.code, 'VALIDATION_FAILED');
    return err;
  }
  throw new Error('unreachable');
}

test('parser: rejects empty input and path-only input', () => {
  assertParseError('   ', 'empty input');
  assertParseError('src/a.py\n', 'has no edit blocks');
});

test('parser: rejects missing separator and missing footer', () => {
  assertParseError('a.txt\n<<<<<<< SEARCH\nfoo\n>>>>>>> REPLACE\n', 'missing "======="');
  assertParseError('a.txt\n<<<<<<< SEARCH\nfoo\n=======\nbar\n', 'missing ">>>>>>> REPLACE"');
});

test('parser: rejects empty search and invalid hints', () => {
  assertParseError('a.txt\n<<<<<<< SEARCH\n=======\nbar\n>>>>>>> REPLACE\n', 'empty SEARCH');
  assertParseError(
    'a.txt\n<<<<<<< SEARCH lines 14-13 (hint)\nfoo\n=======\nbar\n>>>>>>> REPLACE\n',
    'startLine (14) > endLine (13)',
  );
  assertParseError(
    'a.txt\n<<<<<<< SEARCH lines 0\nfoo\n=======\nbar\n>>>>>>> REPLACE\n',
    'startLine must be an integer >= 1',
  );
  assertParseError(
    'a.txt\n<<<<<<< SEARCH lines abc\nfoo\n=======\nbar\n>>>>>>> REPLACE\n',
    'invalid hint',
  );
});

test('parser: rejects delimiter as first line and caps block count', () => {
  assertParseError(
    '<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE\n',
    'must be a relative file path',
  );
  const many = `a.txt\n${'<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n'.repeat(MAX_EDIT_BLOCKS + 1)}`;
  assertParseError(many, 'too many edit blocks');
});
