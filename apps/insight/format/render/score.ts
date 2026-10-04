import type { InsightTraceReport } from '../../types.js';

export interface RankedFile {
  path: string;
  score: number;
  /** 0..1 after test/generated demotion. */
  worth: number;
  spine: boolean;
  named: boolean;
}

/** Kind worth, same scale as the server's askKindWeight. */
export function kindWeight(kind: string): number {
  switch (kind) {
    case 'function':
    case 'method':
    case 'arrow':
    case 'constructor':
    case 'generator':
    case 'async-function':
    case 'async-arrow':
    case 'async-method':
    case 'class':
    case 'interface':
    case 'type':
    case 'enum':
      return 1;
    case 'module':
    case 'const':
      return 0.8;
    case 'unresolved':
      return 0.3;
    default:
      return 0.5;
  }
}

/** Test/spec/fixture paths - ranking only, never exclusion. */
export function isTestPath(p: string): boolean {
  const lower = p.toLowerCase();
  for (const seg of lower.split('/')) {
    switch (seg) {
      case 'test':
      case 'tests':
      case 'spec':
      case 'specs':
      case '__tests__':
      case 'testdata':
      case 'mocks':
      case 'mock':
      case 'fixtures':
      case 'fixture':
        return true;
    }
  }
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  return base.includes('.test.') || base.includes('.spec.');
}

/** Generated/ambient declaration paths, by name alone. */
export function isGeneratedPath(p: string): boolean {
  const lower = p.toLowerCase();
  return (
    lower.endsWith('.d.ts') ||
    lower.endsWith('.pb.go') ||
    lower.endsWith('.pulsar.go') ||
    lower.endsWith('.g.go') ||
    lower.endsWith('.min.js') ||
    lower.includes('__generated__')
  );
}

/** Path demotion. Never stacks: the smallest multiplier wins. */
export function pathPenalty(p: string): number {
  let pen = 1;
  if (isTestPath(p)) pen = 0.5;
  if (isGeneratedPath(p) && 0.3 < pen) pen = 0.3;
  return pen;
}

/** Shape-precise like the server's isAskSymbol: a reference, not noise. */
export function isSymbolToken(t: string): boolean {
  if (/[._$:/]/.test(t)) return true;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c < 65 || c > 90) continue;
    if (i === 0) return true;
    const prev = t.charCodeAt(i - 1);
    if (prev >= 97 && prev <= 122) return true;
  }
  return false;
}

const STEP_BONUS = 25;
const PERIPHERAL_CAP = 5;
const FLOOR_FRACTION = 0.2;
const FLOOR_ABSOLUTE = 1;
const FLOOR_MAX = 10;
const KEEP_MIN = 3;

export interface RankResult {
  ranked: RankedFile[];
  /** Below-floor leftovers, rank order - the Elsewhere list. */
  below: RankedFile[];
  floor: number;
}

/**
 * Rank every file touching the report. Tokens naming a file path pin it.
 * Below-floor files are returned separately, never silently dropped.
 */
export function rankFiles(rep: InsightTraceReport, query: string): RankResult {
  const scores = new Map<string, number>();
  const kinds = new Map<string, string[]>();
  const add = (path: string, pts: number, kind: string): void => {
    scores.set(path, (scores.get(path) ?? 0) + pts);
    const ks = kinds.get(path) ?? [];
    ks.push(kind);
    kinds.set(path, ks);
  };

  const stepFiles = new Set<string>();
  for (const t of rep.trails) {
    for (const id of t.steps) {
      const n = rep.nodes.find((x) => x.id === id);
      if (!n) continue;
      stepFiles.add(n.filePath);
    }
  }
  // Files a precise token anchored: corroboration for bare-word hits.
  const preciseFiles = new Set<string>();
  for (const [tok, hits] of Object.entries(rep.anchors)) {
    if (!isSymbolToken(tok)) continue;
    for (const h of hits) preciseFiles.add(h.filePath);
  }

  for (const [tok, hits] of Object.entries(rep.anchors)) {
    const precise = isSymbolToken(tok);
    for (const h of hits) {
      // Named tier (+50) for the top hit, entry tier (+10) for the rest -
      // mirrors the server's seed tiers so explicitly named files survive.
      const tierPts = h.rank === 0 ? 50 : 10;
      let pts = tierPts * kindWeight(h.kind);
      // FTS-only noise from a bare word earns nothing: demote unless a
      // precise token or a trail step corroborates the file.
      const mode = h.mode;
      if (
        !precise &&
        (mode === 'fts' || mode === 'substring') &&
        !preciseFiles.has(h.filePath) &&
        !stepFiles.has(h.filePath)
      ) {
        pts *= 0.2;
      }
      add(h.filePath, pts, h.kind);
    }
  }
  for (const t of rep.trails) {
    for (const id of t.steps) {
      const n = rep.nodes.find((x) => x.id === id);
      if (!n) continue;
      add(n.filePath, STEP_BONUS * kindWeight(n.kind), n.kind);
    }
  }
  // Peripheral: in the node set but neither anchor nor step.
  const anchorFiles = new Set(
    Object.values(rep.anchors)
      .flat()
      .map((h) => h.filePath),
  );
  const peri = new Map<string, number>();
  for (const n of rep.nodes) {
    if (anchorFiles.has(n.filePath) || stepFiles.has(n.filePath)) continue;
    peri.set(n.filePath, (peri.get(n.filePath) ?? 0) + kindWeight(n.kind));
  }
  for (const [path, pts] of peri) add(path, Math.min(PERIPHERAL_CAP, pts), 'module');

  const lowers = new Set(
    query
      .toLowerCase()
      .split(/[\s,()[\]]+/)
      .filter(Boolean),
  );
  const all: RankedFile[] = [...scores.entries()].map(([path, score]) => {
    const penalized = score * pathPenalty(path);
    return {
      path,
      score: penalized,
      worth: pathPenalty(path),
      spine: stepFiles.has(path),
      // A path token naming the file pins it, like a direct ask for it.
      named: [...lowers].some(
        (t) => t.length >= 3 && path.toLowerCase().includes(t) && t.includes('/'),
      ),
    };
  });
  all.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));

  const top = all.length > 0 ? all[0]!.score : 0;
  const floor = Math.max(FLOOR_ABSOLUTE, Math.min(FLOOR_MAX, top * FLOOR_FRACTION));
  let ranked = all.filter((f) => f.score >= floor || f.named || f.spine);
  let below = all.filter((f) => !ranked.includes(f));
  // Backfill so an ask never answers empty: thin keeps crumbs, empty keeps best.
  if (ranked.length < KEEP_MIN) {
    const thin = ranked.length > 0;
    const extra = below
      .filter((f) => (thin ? f.score >= FLOOR_ABSOLUTE : true))
      .slice(0, KEEP_MIN - ranked.length);
    ranked = [...ranked, ...extra];
    below = below.filter((f) => !ranked.includes(f));
    ranked.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
  }
  return { ranked, below, floor };
}
