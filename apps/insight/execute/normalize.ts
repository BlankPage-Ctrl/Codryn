/**
 * Wire normalization for srcinsight responses.
 *
 * The schemas (search/graph/trace) require the full scored-hit shape, but
 * older binaries still return identity-only hits without it. Every
 * `client.search/graph/trace` result passes through here so the rest of
 * the codebase can rely on the required fields.
 */

import type {
  InsightDialect,
  InsightImportStmt,
  InsightNode,
  InsightSearchHit,
  InsightSearchHitMode,
  InsightStats,
  InsightSymbolKind,
} from '../types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function inferDialect(filePath: string, fallback: unknown): InsightDialect {
  if (fallback === 'typescript' || fallback === 'python' || fallback === 'go') return fallback;
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.py') || lower.endsWith('.pyi')) return 'python';
  if (lower.endsWith('.go')) return 'go';
  return 'typescript';
}

function asKind(v: unknown): InsightSymbolKind {
  return typeof v === 'string' && v !== '' ? (v as InsightSymbolKind) : 'unresolved';
}

function asMode(v: unknown): InsightSearchHitMode {
  if (v === 'exact' || v === 'prefix' || v === 'fts' || v === 'substring') return v;
  return 'exact';
}

/** Fill scored-hit defaults for identity-only (pre-schema) hits. */
export function normalizeInsightSearchHit(raw: unknown): InsightSearchHit {
  const h = isRecord(raw) ? raw : {};
  const filePath = str(h['filePath']);
  const name = str(h['name']);
  return {
    id: str(h['id']),
    name,
    qualifiedName: str(h['qualifiedName'], name),
    kind: asKind(h['kind']),
    filePath,
    lineRange: {
      start: num((h['lineRange'] as Record<string, unknown> | undefined)?.['start'], 0),
      end: num((h['lineRange'] as Record<string, unknown> | undefined)?.['end'], 0),
    },
    dialect: inferDialect(filePath, h['dialect']),
    signature: str(h['signature']),
    doc: str(h['doc']),
    ...(Array.isArray(h['tags'])
      ? { tags: (h['tags'] as unknown[]).filter((t): t is string => typeof t === 'string') }
      : {}),
    ...(isRecord(h['vessel'])
      ? { vessel: h['vessel'] as unknown as InsightSearchHit['vessel'] }
      : {}),
    score: num(h['score']),
    mode: asMode(h['mode']),
    rank: Math.max(0, Math.round(num(h['rank']))),
  };
}

export function normalizeInsightStats(raw: unknown): InsightStats {
  const s = isRecord(raw) ? raw : {};
  const out: InsightStats = {
    filesScanned: Math.max(0, Math.round(num(s['filesScanned']))),
    functionsIndexed: Math.max(0, Math.round(num(s['functionsIndexed']))),
    nodesReturned: Math.max(0, Math.round(num(s['nodesReturned']))),
    edgesReturned: Math.max(0, Math.round(num(s['edgesReturned']))),
  };
  for (const k of ['internalCalls', 'externalCalls', 'unresolvedCalls'] as const) {
    if (typeof s[k] === 'number' && Number.isFinite(s[k]))
      out[k] = Math.max(0, Math.round(s[k] as number));
  }
  return out;
}

/** `alias` is always emitted on the wire (`""` when none). */
export function normalizeInsightImport(raw: unknown): InsightImportStmt {
  const h = isRecord(raw) ? raw : {};
  const kind = h['kind'];
  return {
    localName: str(h['localName']),
    source: str(h['source']),
    kind:
      kind === 'default' ||
      kind === 'named' ||
      kind === 'namespace' ||
      kind === 'side-effect' ||
      kind === 'gopackage'
        ? kind
        : 'named',
    alias: str(h['alias']),
  };
}

/** Ensure ref-list fields exist (older binaries may omit empty arrays). */
export function normalizeInsightNode(raw: unknown): InsightNode {
  const n = (isRecord(raw) ? raw : {}) as Record<string, unknown>;
  const arr = (k: string): [] => (Array.isArray(n[k]) ? (n[k] as []) : []);
  return {
    ...(n as unknown as InsightNode),
    calls: arr('calls') as unknown as InsightNode['calls'],
    calledBy: arr('calledBy') as unknown as InsightNode['calledBy'],
  };
}
