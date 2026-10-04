/**
 * Trace renderer: InsightTraceReport + ReadFileService -> Markdown.
 * Section order is flow-first and table-led. Codeblocks are pure
 * read_file style (dense, line-numbered); files outside the workspace
 * are marked with a manual read_file pointer and NEVER trigger HITL.
 */

import { hardCeiling, pickTier, splitBudget, type ShareInput } from './budget.js';
import { rankFiles, pathPenalty } from './score.js';
import { sliceFile, type Want } from './cluster.js';
import { washRows } from './wash.js';
import { renderWash } from './wash.js';
import { renderImpact, impactFiles } from './impact.js';
import { renderAwakening } from './awake.js';
import { symbolBlocks } from './symbols.js';
import { renderLinks } from './links.js';
import { formatOutsideSection, loadForRender, type RenderCodeReader } from './reader.js';
import { escTick, plural, safeName } from '../shared.js';
import type { InsightTraceReport } from '../../types.js';

export interface RenderInsightTraceOptions {
  query?: string;
  maxFiles?: number;
}

export interface RenderInsightTraceStats {
  files: number;
  symbols: number;
  chars: number;
  trimmed: boolean;
  stale: string[];
  outside: string[];
}

const SYMBOL_HEAD = 10;

/**
 * Schema kinds never include import/export statements, but keep the runtime
 * guard (widened to string) so foreign payloads can never leak them into
 * headers and symbol counts.
 */
function isCodeKind(kind: string): boolean {
  return kind !== 'import' && kind !== 'export';
}

function fileHeader(
  path: string,
  rep: InsightTraceReport,
): { names: string; start: number; end: number; totalHint: number } {
  const nodes = rep.nodes.filter((n) => n.filePath === path && isCodeKind(n.kind));
  const names = nodes.map((n) => `\`${n.kind}\` ${safeName(n.name)}:${n.lineRange.start}`);
  const head = names.slice(0, SYMBOL_HEAD).join(', ');
  const more = names.length > SYMBOL_HEAD ? `, +${names.length - SYMBOL_HEAD} more` : '';
  const start = nodes.length > 0 ? Math.min(...nodes.map((n) => n.lineRange.start)) : 1;
  const end = nodes.length > 0 ? Math.max(...nodes.map((n) => n.lineRange.end)) : 1;
  return { names: `${head}${more}`, start, end, totalHint: end };
}

function renderFlow(rep: InsightTraceReport): string {
  if (rep.trails.length === 0) return '';
  const byId = new Map(rep.nodes.map((n) => [n.id, n] as const));
  const out = ['## Flow', ''];
  rep.trails.forEach((t, i) => {
    if (rep.trails.length > 1) out.push(`trail ${i + 1}:`);
    t.steps.forEach((id, s) => {
      const n = byId.get(id);
      const label = n
        ? `${escTick(n.filePath)}:${n.lineRange.start} ${safeName(n.name)}`
        : escTick(id);
      if (s === 0) {
        out.push(label);
      } else {
        const e = t.edges[s - 1];
        const site = e?.siteRange?.start ? `@${e.siteRange.start}` : '';
        const when = e?.cond ? ` when ${e.cond}` : '';
        out.push(`  --${e?.kind ?? 'calls'}${site}${when}--> ${label}`);
      }
    });
    out.push('');
  });
  return out.join('\n').trimEnd();
}

/** Wants for one file: steps hottest, anchors next, edge sites last. */
function wantsFor(path: string, rep: InsightTraceReport): Want[] {
  const wants: Want[] = [];
  const stepIds = new Set(rep.trails.flatMap((t) => t.steps));
  for (const hits of Object.values(rep.anchors)) {
    for (const h of hits) {
      if (h.filePath === path)
        wants.push({ start: h.lineRange.start, end: h.lineRange.end, weight: 9 });
    }
  }
  for (const n of rep.nodes) {
    if (n.filePath !== path) continue;
    if (stepIds.has(n.id))
      wants.push({ start: n.lineRange.start, end: n.lineRange.end, weight: 10 });
  }
  const byId = new Map(rep.nodes.map((n) => [n.id, n] as const));
  for (const e of rep.edges) {
    const from = byId.get(e.from);
    if (from?.filePath === path && (e.siteRange?.start ?? 0) > 0) {
      wants.push({
        start: e.siteRange!.start,
        end: e.siteRange!.end || e.siteRange!.start,
        weight: 2,
      });
    }
  }
  return wants;
}

function codeSection(
  path: string,
  sliceText: string,
  start: number,
  end: number,
  total: number,
  trimmed: boolean,
): string {
  // Pure read_file style: `# path - lines a-b of N` + plain fence.
  const head = `# \`${safeName(path)}\` — lines ${start}–${end} of ${total}`;
  const tail = trimmed ? '\n_(truncated, narrow the query or render this file directly)_' : '';
  return `${head}\n\`\`\`\n${sliceText}\n\`\`\`${tail}`;
}

export async function formatInsightTrace(
  rep: InsightTraceReport,
  reader: RenderCodeReader,
  opts: RenderInsightTraceOptions = {},
): Promise<{ markdown: string; stats: RenderInsightTraceStats }> {
  const query = opts.query ?? rep.tokens.join(' ');
  const tier = pickTier(rep.stats.filesScanned, 'trace');
  const maxFiles = opts.maxFiles ?? tier.defaultMaxFiles;
  const { ranked, below } = rankFiles(rep, query);

  const head = [`# Trace — ${escTick(query)}`, ''];
  const flow = renderFlow(rep);
  const wash = washRows(rep);
  const washMd = renderWash(wash);
  const impactMd = renderImpact(rep);
  const awakeMd = renderAwakening(rep, wash);
  const links = renderLinks(rep);
  const hot = impactFiles(rep).files.length;
  // Symbol bodies spend first, from a capped reserve; the file envelope
  // is whatever remains after bodies AND meta.
  const symbols = await symbolBlocks(reader, rep, wash.rows, tier.maxOutputChars);
  // Bodies already counted in reserve; only the lists ride in meta.
  const metaChars =
    head.join('\n').length +
    flow.length +
    washMd.length +
    impactMd.length +
    awakeMd.length +
    links.length +
    (symbols.text.length - symbols.reserve) +
    2000; // Code header, guarantee, Elsewhere, footer, summary
  const fileTier = {
    ...tier,
    maxOutputChars: Math.max(3000, tier.maxOutputChars - symbols.reserve - metaChars),
  };

  const inputs: ShareInput[] = ranked.map((f) => ({
    path: f.path,
    score: f.score,
    worth: pathPenalty(f.path),
    spine: f.spine,
    named: f.named,
  }));
  const plan = splitBudget(inputs, fileTier, maxFiles);
  const order = ranked.filter((f) => plan.allowances.has(f.path));

  const sections: string[] = [];
  const stale: string[] = [];
  const outside: string[] = [...symbols.outside];
  const renderedPaths: string[] = [];
  let trimmed = false;

  for (const f of order) {
    const allowance = plan.allowances.get(f.path)!;
    const indexedEnd = Math.max(
      0,
      ...rep.nodes.filter((n) => n.filePath === f.path).map((n) => n.lineRange.end),
    );
    const loaded = await loadForRender(reader, f.path, indexedEnd);
    if (loaded.kind === 'outside') {
      if (!outside.includes(f.path)) outside.push(f.path);
      const info = fileHeader(f.path, rep);
      sections.push(formatOutsideSection(f.path, info.start, info.end, loaded.absolutePath));
      continue;
    }
    if (loaded.kind !== 'ok') {
      stale.push(f.path);
      continue;
    }
    const slice = sliceFile(
      f.path,
      loaded.lines,
      wantsFor(f.path, rep),
      allowance,
      tier.gapThreshold,
      f.spine,
    );
    if (slice.trimmed) trimmed = true;
    const info = fileHeader(f.path, rep);
    sections.push(
      codeSection(f.path, slice.text, 1, loaded.totalLines, loaded.totalLines, slice.trimmed),
    );
    void info;
    renderedPaths.push(f.path);
  }

  const symbolIds = new Set(
    rep.nodes
      .filter((n) => renderedPaths.includes(n.filePath) && isCodeKind(n.kind))
      .map((n) => n.id),
  );

  const body: string[] = [
    ...head,
    `_${plural(rep.tokens.length, 'token', 'tokens')} · ${plural(rep.trails.length, 'trail', 'trails')} · ${plural(symbolIds.size, 'symbol', 'symbols')} · ${plural(renderedPaths.length, 'file', 'files')} · ${plural(wash.rows.length, 'wash', 'wash')} · ${plural(hot, 'hot', 'hot')} · ${plural(symbols.full, 'deep', 'deep')}_`,
    '',
  ];
  if (flow) body.push(flow, '');
  if (washMd) body.push(washMd, '');
  if (impactMd) body.push(impactMd, '');
  if (awakeMd) body.push(awakeMd, '');
  if (links) body.push(links, '');
  if (symbols.text) body.push(symbols.text, '');
  body.push(
    '## Code',
    '',
    '_Source below is re-read at render time and line-numbered; treat it as already read. Files not shown are under Elsewhere: render again with their names._',
    '',
  );

  const ELSE_HEAD = '## Elsewhere';
  const elseLines = [ELSE_HEAD, ''];
  const pointers = [...plan.cliffed, ...below.map((f) => f.path)].filter(
    (p, i, a) => a.indexOf(p) === i,
  );
  for (const p of pointers.slice(0, 10)) {
    const names = rep.nodes
      .filter((n) => n.filePath === p && isCodeKind(n.kind))
      .map((n) => `${safeName(n.name)}:${n.lineRange.start}`);
    const shown = names.slice(0, 6).join(', ');
    elseLines.push(
      `- ${escTick(p)} — ${shown}${names.length > 6 ? `, +${names.length - 6} more` : ''}`,
    );
  }
  if (pointers.length > 10) elseLines.push(`- … and ${pointers.length - 10} more files`);
  if (pointers.length === 0)
    elseLines.push('_Nothing else ranked. The code above is the whole answer._');
  elseLines.push('');

  const ceiling = hardCeiling(tier);
  const foot = '> Tip: Rendered from an insight trace; trails, wash and links are vault data.';
  const staleNote =
    stale.length > 0
      ? `_Stale on disk (line ranges shifted, source omitted): ${stale.map((s) => `\`${escTick(s)}\``).join(', ')}; re-read them directly._`
      : '';
  const outsideNote =
    outside.length > 0
      ? `_Outside workspace (not rendered): ${outside.map((s) => `\`${escTick(s)}\``).join(', ')}._`
      : '';

  // Truncate epilogue first, then whole trailing file sections.
  const epilogue = [...elseLines, foot];
  if (staleNote) epilogue.push('', staleNote);
  if (outsideNote) epilogue.push('', outsideNote);
  let text = [...body, ...sections, '', ...epilogue].join('\n');
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

  // Recount from survivors: only sections still present count.
  const survivors = renderedPaths.filter((p) => text.includes(`# \`${p}\``));
  const keptSymbols = new Set(
    rep.nodes.filter((n) => survivors.includes(n.filePath)).map((n) => n.id),
  ).size;
  const lines = text.split('\n');
  const sumIdx = lines.findIndex((l) => l.includes('tokens ·'));
  if (sumIdx >= 0) {
    lines[sumIdx] =
      `_${plural(rep.tokens.length, 'token', 'tokens')} · ${plural(rep.trails.length, 'trail', 'trails')} · ${plural(keptSymbols, 'symbol', 'symbols')} · ${plural(survivors.length, 'file', 'files')} · ${plural(wash.rows.length, 'wash', 'wash')} · ${plural(hot, 'hot', 'hot')}_`;
    text = lines.join('\n');
  }

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
