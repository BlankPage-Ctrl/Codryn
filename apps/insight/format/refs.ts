import type { InsightFunctionRef } from '../types.js';
import {
  escTick,
  isExternalScope,
  isInternalScope,
  matchesScopeFilter,
  safeName,
  scopeTag,
  type InsightScopeFilter,
} from './shared.js';

export interface RefSectionOptions {
  refLimit: number;
  includeScopes?: InsightScopeFilter;
}

export function formatRefLine(ref: InsightFunctionRef): string {
  const name = safeName(ref.name);
  const loc = `${escTick(ref.filePath)}:${ref.lineRange.start}-${ref.lineRange.end}`;
  const scope = scopeTag(ref);
  const idPart = ref.id ? ` \`${escTick(ref.id)}\`` : '';
  // Branch guard rides along when present; siteRange {0,0} means unknown
  // and is not shown (the definition range above is the stable locator).
  const when = ref.cond ? ` when \`${escTick(ref.cond)}\`` : '';
  // Compact one-liner: name - file:line `scope` `id`
  return `- \`${name}\` - \`${loc}\` \`${scope}\`${idPart}${when}`;
}

export function sectionLines(
  title: string,
  refs: InsightFunctionRef[] | undefined,
  opts: RefSectionOptions,
): string[] | null {
  const arr = (refs ?? []).filter((r) => matchesScopeFilter(r, opts.includeScopes));
  if (arr.length === 0) return null;
  // Stable sort: internal first, then by filePath/name (mirip formatListDir dirs-first)
  const sorted = [...arr].sort((a, b) => {
    const rank = (r: InsightFunctionRef) =>
      isInternalScope(r.scope) ? 0 : isExternalScope(r.scope) ? 1 : 2;
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const fp = a.filePath.localeCompare(b.filePath);
    if (fp !== 0) return fp;
    return a.name.localeCompare(b.name);
  });
  const shown = sorted.slice(0, opts.refLimit);
  const head = `## ${title} (${arr.length})`;
  const lines = shown.map(formatRefLine);
  if (arr.length > shown.length) {
    lines.push(
      `... +${arr.length - shown.length} more (use refLimit:${opts.refLimit + arr.length - shown.length} or \`insight_graph\` ID for detail)`,
    );
  }
  return [head, ...lines];
}
