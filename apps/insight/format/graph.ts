import type { InsightEdge, InsightFunctionRef, InsightGraph, InsightNode } from '../types.js';
import { clampRefLimit } from './constants.js';
import { formatInsightError } from './errors.js';
import { sectionLines } from './refs.js';
import {
  escTick,
  isExternalScope,
  isInternalScope,
  isUnresolvedScope,
  plural,
  safeName,
  type InsightScopeFilter,
} from './shared.js';

export interface FormatInsightGraphOptions {
  /** Per-section cap for calls/calledBy/paramTypes etc. Default 12. */
  refLimit?: number;
  /** Filter refs by scope prefix. Default: all. */
  includeScopes?: InsightScopeFilter;
  /** Compact hides edge table & truncates doc/signature. Default true. */
  compact?: boolean;
}

function formatSignature(sig: string, compact: boolean): string {
  const s = sig.trim();
  if (!compact) return s;
  // Compact but keep full signature unless > 240 chars, then truncate middle-preserving ends
  if (s.length <= 240) return s;
  return `${s.slice(0, 180)} … ${s.slice(-40)}`;
}

function formatDoc(doc: string | undefined, compact: boolean): string | null {
  if (!doc) return null;
  const t = doc.trim();
  if (t.length === 0) return null;
  if (!compact) return t;
  // Compact: keep first 280 chars, preserve line breaks as single line preview
  const oneLine = t.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 280) return oneLine;
  return `${oneLine.slice(0, 277)}…`;
}

function edgeKindSummary(edges: InsightEdge[]): string {
  const counts = new Map<string, number>();
  for (const e of edges) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`);
  return parts.join(', ');
}

function formatEdgeTable(edges: InsightEdge[], refLimit: number): string[] {
  // Only render table if edges not huge; else summary is enough
  if (edges.length === 0) return [];
  if (edges.length > refLimit * 2) return [];
  const lines: string[] = ['## Edges', '| from | to | kind |', '|---|---|---|'];
  for (const e of edges.slice(0, refLimit * 2)) {
    lines.push(`| \`${escTick(e.from)}\` | \`${escTick(e.to)}\` | \`${escTick(e.kind)}\` |`);
  }
  if (edges.length > refLimit * 2) lines.push(`| ... +${edges.length - refLimit * 2} more | | |`);
  return lines;
}

/**
 * Render a single-root InsightGraph (nodes=[root]) as token-balanced markdown.
 * - Compact default true: hides edge table, truncates long doc/signature, keeps all sections.
 * - In compact mode still informative: counts, scope tags, ids for internal refs, dedup hint for shared types.
 */
export function formatInsightGraph(
  graph: InsightGraph,
  opts: FormatInsightGraphOptions = {},
): string {
  const refLimit = clampRefLimit(opts.refLimit);
  const compact = opts.compact ?? true;
  const includeScopes = opts.includeScopes;

  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return formatInsightError('INSIGHT_EMPTY', 'graph has no nodes');
  }

  const root: InsightNode = graph.nodes[0] as InsightNode;
  const edges: InsightEdge[] = graph.edges ?? [];

  // Header - mirrors formatReadFile `# path - lines` style
  const loc = `${escTick(root.filePath)}:${root.lineRange.start}-${root.lineRange.end}`;
  const header = `# \`${safeName(root.name)}\` (\`${escTick(root.kind)}\`) - \`${loc}\``;

  // Subheader: file + container + id
  const fileName = safeName(root.file?.name ?? root.filePath.split('/').pop() ?? root.filePath);
  const fileId = escTick(root.file?.id ?? `file:${root.filePath}`);
  const fileLine = `File: \`${fileName}\` \`${fileId}\``;
  const containerLine = root.container
    ? `Container: \`${escTick(root.container.kind)}\` \`${safeName(root.container.name)}\` \`${escTick(root.container.id)}\``
    : null;
  const idLine = `ID: \`${escTick(root.id)}\``;

  const sig = formatSignature(root.signature, compact);
  const sigBlock = `> \`${escTick(sig)}\``;

  const doc = formatDoc(root.doc, compact);
  const docBlock = doc ? `> ${doc}` : null;

  // Stats line - token-cheap summary before sections
  const counts: Array<{ label: string; n: number }> = [
    { label: 'calls', n: (root.calls ?? []).length },
    { label: 'calledBy', n: (root.calledBy ?? []).length },
    { label: 'extends', n: (root.extends ?? []).length },
    { label: 'implements', n: (root.implements ?? []).length },
    { label: 'paramTypes', n: (root.paramTypes ?? []).length },
    { label: 'returnTypes', n: (root.returnTypes ?? []).length },
    { label: 'uses', n: (root.uses ?? []).length },
  ];
  const nonZero = counts.filter((c) => c.n > 0);
  const statsCore =
    nonZero.length > 0
      ? nonZero.map((c) => `${plural(c.n, c.label, c.label)}`).join(', ')
      : 'no refs';
  const edgeSummary =
    edges.length > 0
      ? ` - ${plural(edges.length, 'edge', 'edges')} (${edgeKindSummary(edges)}, 1-hop, no BFS)`
      : '';
  const statsLine = `_${statsCore}${edgeSummary}_`;

  // Scope hint (internal vs external) - short, helps agent decide next step
  const allRefs: InsightFunctionRef[] = [
    ...(root.calls ?? []),
    ...(root.calledBy ?? []),
    ...(root.extends ?? []),
    ...(root.implements ?? []),
    ...(root.paramTypes ?? []),
    ...(root.returnTypes ?? []),
    ...(root.uses ?? []),
  ];
  const internalCount = allRefs.filter((r) => isInternalScope(r.scope)).length;
  const externalCount = allRefs.filter((r) => isExternalScope(r.scope)).length;
  const unresolvedCount = allRefs.filter((r) => isUnresolvedScope(r.scope)).length;
  const scopeLine =
    allRefs.length > 0
      ? `_scopes: internal×${internalCount}, external×${externalCount}, unresolved×${unresolvedCount}_`
      : null;

  // Dedup hint for shared types (param & return same type) - saves agent from fetching twice
  let dedupHint: string | null = null;
  if ((root.paramTypes?.length ?? 0) > 0 && (root.returnTypes?.length ?? 0) > 0) {
    const pIds = new Set((root.paramTypes ?? []).map((r) => r.id).filter(Boolean));
    const shared = (root.returnTypes ?? []).filter((r) => r.id && pIds.has(r.id));
    if (shared.length > 0) {
      const names = [...new Set(shared.map((r) => safeName(r.name)))].slice(0, 3).join(', ');
      dedupHint = `> _param & return share: \`${names}\` - fetch once via \`insight_graph\` with ID_`;
    }
  }

  // Sections
  const sections: string[][] = [];
  const callsSec = sectionLines('Calls', root.calls, { refLimit, includeScopes });
  if (callsSec) sections.push(callsSec);
  const calledBySec = sectionLines('Called By', root.calledBy, { refLimit, includeScopes });
  if (calledBySec) sections.push(calledBySec);
  const extendsSec = sectionLines('Extends', root.extends, { refLimit, includeScopes });
  if (extendsSec) sections.push(extendsSec);
  const implementsSec = sectionLines('Implements', root.implements, { refLimit, includeScopes });
  if (implementsSec) sections.push(implementsSec);
  const paramSec = sectionLines('Param Types', root.paramTypes, { refLimit, includeScopes });
  if (paramSec) sections.push(paramSec);
  const returnSec = sectionLines('Return Types', root.returnTypes, { refLimit, includeScopes });
  if (returnSec) sections.push(returnSec);
  const usesSec = sectionLines('Uses', root.uses, { refLimit, includeScopes });
  if (usesSec) sections.push(usesSec);

  // If all sections empty but edges exist (e.g. uses edge only via edges[] not mapped to node field), still show edge summary
  // In that case we already have statsLine; no extra handling needed.

  const parts: string[] = [header, sigBlock];
  if (docBlock) parts.push(docBlock);
  parts.push([fileLine, containerLine, idLine].filter(Boolean).join(' | '));
  parts.push(statsLine);
  if (scopeLine) parts.push(scopeLine);
  if (dedupHint) parts.push(dedupHint);

  if (sections.length === 0) {
    parts.push('_no outgoing/incoming refs in this 1-hop view_');
  } else {
    for (const sec of sections) {
      parts.push('', ...sec);
    }
  }

  // Edge table only when compact=false (detailed view)
  if (!compact) {
    const edgeTable = formatEdgeTable(edges, refLimit);
    if (edgeTable.length > 0) {
      parts.push('', ...edgeTable);
    }
  }

  // Footer hint - actionable for agent
  parts.push(
    '',
    `> Tip: Try \`insight_graph\` with ID for internal refs(if needed), \`read_file\` ${escTick(root.filePath)} and line ${root.lineRange.start}-${root.lineRange.end} for body.`,
  );

  return parts.join('\n');
}
