/**
 * Impact section: ripples rolled up per file, hottest file first.
 * Same data as Wash from the other side - per file, not per symbol.
 * Without a ripple walk this degrades to a direct 1-hop rollup.
 */

import type { InsightRipple, InsightTraceReport } from '../../types.js';

export const IMPACT_MAX_FILES = 10;

export interface ImpactFile {
  path: string;
  symbols: string[];
  callers: number;
}

/** Files with callers>0, hottest first. Totals are exact sums. */
export function impactFiles(
  rep: InsightTraceReport,
  ripples?: Record<string, InsightRipple>,
): { files: ImpactFile[]; overflow: number; direct: boolean } {
  const acc = new Map<string, { symbols: Map<string, string>; callers: number }>();
  const add = (path: string, id: string, name: string, n: number): void => {
    let g = acc.get(path);
    if (!g) {
      g = { symbols: new Map(), callers: 0 };
      acc.set(path, g);
    }
    g.symbols.set(id, name);
    g.callers += n;
  };
  let direct = false;
  if (ripples) {
    const byId = new Map(rep.nodes.map((n) => [n.id, n] as const));
    for (const [id, r] of Object.entries(ripples)) {
      if (r.callers <= 0) continue;
      const n = byId.get(id);
      if (!n?.filePath) continue;
      add(n.filePath, id, n.name, r.callers);
    }
  } else {
    // No ripples: roll up direct 1-hop CalledBy instead.
    // Partial by construction - the walk behind it never ran.
    direct = true;
    for (const n of rep.nodes) {
      if (n.calledBy.length === 0) continue;
      add(n.filePath, n.id, n.name, n.calledBy.length);
    }
  }
  const files: ImpactFile[] = [...acc.entries()].map(([path, g]) => ({
    path,
    // Overloads share a name: display unique names, ids stay distinct.
    symbols: [...new Set(g.symbols.values())].sort(),
    callers: g.callers,
  }));
  files.sort((a, b) => b.callers - a.callers || (a.path < b.path ? -1 : 1));
  const overflow = Math.max(0, files.length - IMPACT_MAX_FILES);
  return { files: files.slice(0, IMPACT_MAX_FILES), overflow, direct };
}

export function renderImpact(
  rep: InsightTraceReport,
  ripples?: Record<string, InsightRipple>,
): string {
  const { files, overflow, direct } = impactFiles(rep, ripples);
  if (files.length === 0) return '';
  const out = ['## Impact', '', '| file | symbols | callers |', '|---|---|---|'];
  for (const f of files) {
    out.push(`| \`${f.path}\` | ${f.symbols.join(', ')} | ${f.callers} |`);
  }
  if (overflow > 0) out.push(`| … +${overflow} more files | | |`);
  if (direct)
    out.push(
      '',
      '_Direct 1-hop rollup: this trace carries no ripple walk, so deeper callers are not counted._',
    );
  return out.join('\n');
}
