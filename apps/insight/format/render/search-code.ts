/**
 * Search renderer: InsightSearchResult + ReadFileService -> Markdown.
 *
 * Display order mixes modes by strength: exact always on top, then prefix,
 * then fts by relevance (bm25 ascending - more negative = more relevant),
 * then substring. File sections reuse the trace budget pipeline so Code
 * output shares one envelope like trace does.
 */

import { hardCeiling, pickTier, splitBudget, type ShareInput } from './budget.js';
import { kindWeight, pathPenalty, isTestPath, isGeneratedPath } from './score.js';
import { sliceFile, type Want } from './cluster.js';
import { formatOutsideSection, loadForRender, type RenderCodeReader } from './reader.js';
import { escTick, plural, safeName } from '../shared.js';
import type { InsightSearchHit, InsightSearchResult } from '../../types.js';

export interface SearchCodeRenderOptions {
  maxFiles?: number;
}

export interface SearchCodeRenderStats {
  files: number;
  symbols: number;
  chars: number;
  trimmed: boolean;
  stale: string[];
  outside: string[];
}

const MODE_ORDER: Record<string, number> = {
  exact: 0,
  prefix: 1,
  fts: 2,
  substring: 3,
};

/**
 * Mixed display order: exact > prefix > fts (score asc) > substring.
 * Unknown modes sink to the bottom. Ties: rank, then kind weight, then id.
 */
export function orderHits(hits: InsightSearchHit[]): InsightSearchHit[] {
  return [...hits].sort((a, b) => {
    const oa = MODE_ORDER[a.mode] ?? 9;
    const ob = MODE_ORDER[b.mode] ?? 9;
    if (oa !== ob) return oa - ob;
    if (a.mode === 'fts' && b.mode === 'fts' && a.score !== b.score) {
      return a.score - b.score;
    }
    if (a.rank !== b.rank) return a.rank - b.rank;
    const ka = kindWeight(a.kind);
    const kb = kindWeight(b.kind);
    if (ka !== kb) return kb - ka;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function modeBadge(h: InsightSearchHit): string {
  switch (h.mode) {
    case 'exact':
      return '[exact]';
    case 'prefix':
      return '[prefix]';
    case 'fts':
      return `[fts ${h.score}]`;
    case 'substring':
      return '[sub]';
    default:
      return `[${h.mode}]`;
  }
}

function oneLine(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function hitBlock(i: number, h: InsightSearchHit): string {
  const at = `${escTick(h.filePath)}:${h.lineRange.start}`;
  const vessel = h.vessel ? ` in \`${safeName(h.vessel.name)}\`` : '';
  const flag = isTestPath(h.filePath)
    ? ' (test)'
    : isGeneratedPath(h.filePath)
      ? ' (generated)'
      : '';
  const tags =
    h.tags && h.tags.length > 0
      ? ` tags: ${h.tags.map((t) => `\`${escTick(t)}\``).join(', ')}`
      : '';
  const lines = [
    `${i + 1}. ${modeBadge(h)} \`${safeName(h.name)}\` (\`${escTick(h.kind)}\`, \`${h.dialect}\`) — \`${at}\`${vessel}${tags}${flag}`,
    `   \`qualified:\` \`${escTick(h.qualifiedName)}\` · \`rank:\` ${h.rank} · \`id:\` \`${escTick(h.id)}\``,
  ];
  const sig = h.signature.trim();
  if (sig !== '') lines.push(`   \`${escTick(oneLine(sig, 220))}\``);
  if (h.doc.trim()) lines.push(`   _${escTick(oneLine(h.doc, 200))}_`);
  return lines.join('\n');
}

/** Wants for one file: top-ranked hits hottest. */
function wantsFor(path: string, hits: InsightSearchHit[]): Want[] {
  const out: Want[] = [];
  for (const h of hits) {
    if (h.filePath !== path) continue;
    out.push({ start: h.lineRange.start, end: h.lineRange.end, weight: h.rank === 0 ? 10 : 9 });
  }
  return out;
}

export async function formatInsightSearchWithCode(
  rep: InsightSearchResult,
  reader: RenderCodeReader,
  opts: SearchCodeRenderOptions = {},
): Promise<{ markdown: string; stats: SearchCodeRenderStats }> {
  const ordered = orderHits(rep.hits ?? []);
  const query = rep.query ?? '';

  if (ordered.length === 0) {
    const scanned = rep.stats?.filesScanned ?? 0;
    const indexed = rep.stats?.functionsIndexed ?? 0;
    const text = [
      `# Search: "${escTick(query)}" - 0 hits`,
      `_${plural(scanned, 'file', 'files')} scanned, ${plural(indexed, 'function', 'functions')} indexed_`,
      '',
      '_no matches_ - try broader query, different mode (`auto`/`substring`/`fts`), or `list_files` to discover files.',
      '',
      `> Tip: try \`insight_search\` ${escTick(query)} with substring mode or check spelling.`,
    ].join('\n');
    return {
      markdown: text,
      stats: { files: 0, symbols: 0, chars: text.length, trimmed: false, stale: [], outside: [] },
    };
  }

  const tier = pickTier(rep.stats?.filesScanned ?? 0, 'search');
  const maxFiles = opts.maxFiles ?? tier.defaultMaxFiles;

  // File budget scores mirror score.ts anchor tiers: top hit 50, rest 10,
  // weighted by kind, demoted (never excluded) for test/generated paths.
  const byFile = new Map<string, { score: number; hits: InsightSearchHit[] }>();
  for (const h of ordered) {
    const pts = (h.rank === 0 ? 50 : 10) * kindWeight(h.kind);
    const cur = byFile.get(h.filePath) ?? { score: 0, hits: [] };
    cur.score += pts;
    cur.hits.push(h);
    byFile.set(h.filePath, cur);
  }
  const lowers = new Set(
    query
      .toLowerCase()
      .split(/[\s,;()[\]]+/)
      .filter(Boolean),
  );
  const inputs: ShareInput[] = [...byFile.entries()].map(([path, v]) => ({
    path,
    score: v.score,
    worth: pathPenalty(path),
    spine: false,
    named: [...lowers].some(
      (t) => t.length >= 3 && path.toLowerCase().includes(t) && t.includes('/'),
    ),
  }));
  inputs.sort((a, b) => b.score * b.worth - a.score * a.worth || (a.path < b.path ? -1 : 1));
  const plan = splitBudget(inputs, tier, maxFiles);
  const order = inputs.filter((f) => plan.allowances.has(f.path));

  const counts = { exact: 0, prefix: 0, fts: 0, substring: 0, other: 0 };
  for (const h of ordered) {
    const m = h.mode;
    if (m in counts) (counts as Record<string, number>)[m]! += 1;
    else counts.other += 1;
  }

  const head = [`# Search — ${escTick(query)}`, ''];
  const hitsMd = [
    '## Hits',
    '',
    '_ordering: exact on top · prefix next · fts by relevance (bm25 asc) closest below exact · substring last · server rank shown per hit._',
    '',
    ...ordered.map((h, i) => hitBlock(i, h)),
    '',
  ];

  const sections: string[] = [];
  const stale: string[] = [];
  const outside: string[] = [];
  const renderedPaths: string[] = [];
  let trimmed = false;
  const metaChars = head.join('\n').length + hitsMd.join('\n').length + 2000;
  const fileTier = { ...tier, maxOutputChars: Math.max(3000, tier.maxOutputChars - metaChars) };

  for (const f of order) {
    const allowance = Math.min(plan.allowances.get(f.path)!, fileTier.maxCharsPerFile);
    const hits = byFile.get(f.path)!.hits;
    const indexedEnd = Math.max(0, ...hits.map((h) => h.lineRange.end));
    const loaded = await loadForRender(reader, f.path, indexedEnd);
    if (loaded.kind === 'outside') {
      if (!outside.includes(f.path)) outside.push(f.path);
      sections.push(
        formatOutsideSection(
          f.path,
          hits[0]!.lineRange.start,
          hits[0]!.lineRange.end,
          loaded.absolutePath,
        ),
      );
      continue;
    }
    if (loaded.kind !== 'ok') {
      stale.push(f.path);
      continue;
    }
    const slice = sliceFile(
      f.path,
      loaded.lines,
      wantsFor(f.path, hits),
      allowance,
      tier.gapThreshold,
      false,
    );
    if (slice.trimmed) trimmed = true;
    const names = hits
      .map((h) => `\`${h.kind}\` ${safeName(h.name)}:${h.lineRange.start}`)
      .join(', ');
    void names;
    sections.push(
      `# \`${safeName(f.path)}\` — lines 1–${loaded.totalLines} of ${loaded.totalLines}\n\`\`\`\n${slice.text}\n\`\`\`${slice.trimmed ? '\n_(truncated, narrow the query or render this file directly)_' : ''}`,
    );
    renderedPaths.push(f.path);
  }

  const rankedPaths = inputs.map((f) => f.path);
  const pointers = [
    ...plan.cliffed,
    ...rankedPaths.filter(
      (p) => !renderedPaths.includes(p) && !outside.includes(p) && !plan.allowances.has(p),
    ),
  ].filter((p, i, a) => a.indexOf(p) === i);

  const body: string[] = [
    ...head,
    `_${plural(ordered.length, 'hit', 'hits')} (${counts.exact} exact · ${counts.prefix} prefix · ${counts.fts} fts · ${counts.substring} sub) · ${plural(byFile.size, 'file', 'files')} · ${plural(renderedPaths.length, 'shown', 'shown')}_`,
    '',
    ...hitsMd,
    '## Code',
    '',
    '_Source below is re-read at render time and line-numbered — treat it as already read. Files not shown are under Elsewhere: render again with their names._',
    '',
  ];

  const elseLines = ['## Elsewhere', ''];
  for (const p of pointers.slice(0, 10)) {
    const names = (byFile.get(p)?.hits ?? []).map(
      (h) => `${safeName(h.name)}:${h.lineRange.start}`,
    );
    const shown = names.slice(0, 6).join(', ');
    elseLines.push(
      `- ${escTick(p)} — ${shown}${names.length > 6 ? `, +${names.length - 6} more` : ''}`,
    );
  }
  if (pointers.length > 10) elseLines.push(`- … and ${pointers.length - 10} more files`);
  if (pointers.length === 0)
    elseLines.push('_Nothing else ranked. The code above is the whole answer._');
  elseLines.push('');

  const foot =
    '> Tip: Rendered from an insight search; the hits table is vault data (mode/rank/score per hit).';
  const staleNote =
    stale.length > 0
      ? `_Stale on disk (line ranges shifted, source omitted): ${stale.map((s) => `\`${escTick(s)}\``).join(', ')}._`
      : '';
  const outsideNote =
    outside.length > 0
      ? `_Outside workspace (not rendered): ${outside.map((s) => `\`${escTick(s)}\``).join(', ')}._`
      : '';

  const epilogue = [...elseLines, foot];
  if (staleNote) epilogue.push('', staleNote);
  if (outsideNote) epilogue.push('', outsideNote);
  let text = [...body, ...sections, '', ...epilogue].join('\n');
  const ceiling = hardCeiling(tier);
  if (text.length > ceiling) {
    text = [...body, ...sections].join('\n');
    if (text.length > ceiling) {
      const cut = text.slice(0, ceiling);
      const at = cut.lastIndexOf('\n# `');
      const safe = at > ceiling * 0.5 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf('\n'));
      text = `${safe}\n\n_Tip: Output cut to budget; the source above is complete._`;
      trimmed = true;
    } else {
      text += '\n\n_Trailing notes cut for size; the source above is complete._';
      trimmed = true;
    }
  }

  const survivors = renderedPaths.filter((p) => text.includes(`# \`${p}\``));
  const keptSymbols = ordered.filter((h) => survivors.includes(h.filePath)).length;
  return {
    markdown: text,
    stats: {
      files: survivors.length,
      symbols: keptSymbols,
      chars: text.length,
      trimmed,
      stale,
      outside,
    },
  };
}
