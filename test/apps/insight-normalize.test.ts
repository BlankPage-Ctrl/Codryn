import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeInsightImport,
  normalizeInsightNode,
  normalizeInsightSearchHit,
  normalizeInsightStats,
} from '../../apps/insight/execute/normalize.js';

test('normalize: identity-only hit from old binary gets schema defaults', () => {
  const hit = normalizeInsightSearchHit({
    id: 'ts:src/a.ts:function:foo:0',
    name: 'foo',
    kind: 'function',
    filePath: 'src/a.ts',
    lineRange: { start: 10, end: 12 },
  });
  assert.equal(hit.qualifiedName, 'foo');
  assert.equal(hit.dialect, 'typescript');
  assert.equal(hit.signature, '');
  assert.equal(hit.doc, '');
  assert.equal(hit.score, 0);
  assert.equal(hit.mode, 'exact');
  assert.equal(hit.rank, 0);
  assert.equal(hit.tags, undefined);
});

test('normalize: dialect inferred from extension when missing', () => {
  assert.equal(normalizeInsightSearchHit({ filePath: 'x.py' }).dialect, 'python');
  assert.equal(normalizeInsightSearchHit({ filePath: 'x.go' }).dialect, 'go');
  assert.equal(
    normalizeInsightSearchHit({ filePath: 'x.go', dialect: 'go', kind: 'method' }).kind,
    'method',
  );
});

test('normalize: full schema hit passes through incl. tags/vessel', () => {
  const hit = normalizeInsightSearchHit({
    id: 'go:core/svc.go:method:Run:0',
    name: 'Run',
    qualifiedName: 'Svc.Run',
    kind: 'method',
    filePath: 'core/svc.go',
    lineRange: { start: 1, end: 5 },
    dialect: 'go',
    signature: 'func (s *Svc) Run()',
    doc: 'runs it',
    tags: ['controller'],
    vessel: { kind: 'class', id: 'go:core/svc.go:class:Svc:0', name: 'Svc' },
    score: -12.5,
    mode: 'fts',
    rank: 2,
  });
  assert.equal(hit.dialect, 'go');
  assert.deepEqual(hit.tags, ['controller']);
  assert.equal(hit.vessel?.kind, 'class');
  assert.equal(hit.score, -12.5);
});

test('normalize: stats fills edgesReturned, keeps call counters', () => {
  const s = normalizeInsightStats({ filesScanned: 3, functionsIndexed: 9, nodesReturned: 2 });
  assert.equal(s.edgesReturned, 0);
  assert.equal(s.internalCalls, undefined);
  const s2 = normalizeInsightStats({
    filesScanned: 3,
    functionsIndexed: 9,
    nodesReturned: 2,
    edgesReturned: 4,
    internalCalls: 4,
    unresolvedCalls: 1,
  });
  assert.equal(s2.edgesReturned, 4);
  assert.equal(s2.internalCalls, 4);
  assert.equal(s2.unresolvedCalls, 1);
});

test('normalize: import gopackage kept, alias defaults to empty string', () => {
  const stmt = normalizeInsightImport({ localName: 'svc', source: 'core', kind: 'gopackage' });
  assert.equal(stmt.kind, 'gopackage');
  assert.equal(stmt.alias, '');
});

test('normalize: node without ref lists gets empty arrays', () => {
  const n = normalizeInsightNode({ id: 'x', name: 'x' });
  assert.deepEqual(n.calls, []);
  assert.deepEqual(n.calledBy, []);
});
