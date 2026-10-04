import type { InsightSearchHit, InsightSearchResult } from '../types.js';
import { clampSearchLimit } from './constants.js';
import { escTick, plural, safeName } from './shared.js';

export interface FormatInsightSearchOptions {
  limit?: number;
  compact?: boolean;
}

function formatSearchHitLine(hit: InsightSearchHit): string {
  const name = safeName(hit.name);
  const kind = escTick(hit.kind);
  const idPart = hit.id ? ` \`${escTick(hit.id)}\`` : '';
  const tags =
    hit.tags && hit.tags.length > 0
      ? ` tags: ${hit.tags.map((t) => `\`${escTick(t)}\``).join(', ')}`
      : '';
  return `- Name \`${name}\` (\`${kind}\`, \`${hit.dialect}\`) - Path\`${escTick(hit.filePath)}\` at Line ${hit.lineRange.start ?? ''}-${hit.lineRange.end ?? ''} with ID: \`${idPart}\`${tags}`;
}

export function formatInsightSearch(
  result: InsightSearchResult,
  opts: FormatInsightSearchOptions = {},
): string {
  const q = escTick((result.query ?? '').trim());
  const hits = Array.isArray(result.hits) ? result.hits : [];
  const stats = result.stats ?? {
    filesScanned: 0,
    functionsIndexed: 0,
    nodesReturned: hits.length,
  };
  const limit = clampSearchLimit(opts.limit);

  // Empty case - keep actionable
  if (hits.length === 0) {
    const head = `# Search: "${q}" - 0 hits`;
    const meta =
      stats.filesScanned != null || stats.functionsIndexed != null
        ? `_${plural(stats.filesScanned ?? 0, 'file', 'files')} scanned, ${plural(stats.functionsIndexed ?? 0, 'function', 'functions')} indexed_`
        : '_no results_';
    return [
      head,
      meta,
      '',
      '_no matches_ - try broader query, different mode (`auto`/`substring`/`fts`), or `list_files` to discover files.',
      '',
      `> Tip: try \`insight_search\` ${q} with substring mode or check spelling.`,
    ].join('\n');
  }

  // Non-empty: stable sort by filePath then name
  const sorted = [...hits].sort((a, b) => {
    const fp = a.filePath.localeCompare(b.filePath);
    if (fp !== 0) return fp;
    return a.name.localeCompare(b.name);
  });

  const shown = sorted.slice(0, limit);
  const total = hits.length;
  const head =
    total > shown.length
      ? `# Search: "${q}" - ${shown.length} of ${total} shown`
      : `# Search: "${q}" - ${plural(total, 'hit', 'hits')}`;

  // Stats line
  const statsLine = `_scanned ${stats.filesScanned ?? 0} files, ${stats.functionsIndexed ?? 0} functions, ${plural(stats.nodesReturned ?? total, 'node', 'nodes')} returned_`;

  const lines = shown.map(formatSearchHitLine);

  if (total > shown.length) {
    lines.push(
      `... +${total - shown.length} more (use limit:${limit + (total - shown.length)} or narrower query)`,
    );
  }

  // Kind summary
  const kindCounts = new Map<string, number>();
  for (const h of hits) kindCounts.set(h.kind, (kindCounts.get(h.kind) ?? 0) + 1);
  const kindSummary = [...kindCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, n]) => `${k}×${n}`)
    .join(', ');
  const kindLine = kindSummary ? `_kinds: ${kindSummary}_` : null;

  const parts: string[] = [head, statsLine];
  if (kindLine) parts.push(kindLine);
  parts.push('', ...lines);
  parts.push(
    '',
    `> Tip: Use \`insight_graph\` with id for deps; \`read_file\` with path and range for body.`,
  );

  return parts.join('\n');
}
