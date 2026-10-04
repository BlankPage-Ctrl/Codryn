import type { InsightTraceReport } from '../../types.js';
import { isTestPath } from './score.js';

const PER_KIND = 10;

interface Group {
  kind: string;
  from: string;
  fromFile: string;
  to: string;
  count: number;
  test: boolean;
}

function baseName(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function nodeName(rep: InsightTraceReport, id: string): { name: string; file: string } {
  const n = rep.nodes.find((x) => x.id === id);
  if (n) return { name: n.name, file: n.filePath };
  const tail = id.split(':').pop() ?? id;
  return { name: tail.split('.').pop() ?? tail, file: '' };
}

/** Collapse identical edges: one line per (kind, from, file, to) with xN. */
function groupEdges(rep: InsightTraceReport): Group[] {
  const map = new Map<string, Group>();
  for (const e of rep.edges) {
    const from = nodeName(rep, e.from);
    const to = nodeName(rep, e.to);
    const key = `${e.kind}\x00${from.name}\x00${from.file}\x00${to.name}`;
    const g = map.get(key);
    if (g) {
      g.count++;
    } else {
      map.set(key, {
        kind: e.kind,
        from: from.name,
        fromFile: from.file,
        to: to.name,
        count: 1,
        test: from.file !== '' && isTestPath(from.file),
      });
    }
  }
  const groups = [...map.values()];
  // Signal first: non-test groups by count, then test groups by count.
  groups.sort(
    (a, b) => Number(a.test) - Number(b.test) || b.count - a.count || (a.from < b.from ? -1 : 1),
  );
  return groups;
}

function renderGroup(g: Group, multiFile: Set<string>): string {
  // @ Location when it disambiguates: collapsed rows, anonymous, or the
  // same name calling from several files. Multi-file prints the full
  // project-relative path; the rest keep the short basename form.
  const loc =
    g.fromFile !== '' && (g.count > 1 || g.from === 'anonymous' || multiFile.has(g.from))
      ? ` (${multiFile.has(g.from) ? g.fromFile : baseName(g.fromFile)})`
      : '';
  const times = g.count > 1 ? ` ×${g.count}` : '';
  return `- ${g.from}${times}${loc} --> ${g.to}`;
}

/** ### kind groups in signal order, capped at PER_KIND groups. */
export function renderLinks(rep: InsightTraceReport): string {
  if (rep.edges.length === 0) return '';
  const byKind = new Map<string, Group[]>();
  for (const g of groupEdges(rep)) {
    const list = byKind.get(g.kind) ?? [];
    list.push(g);
    byKind.set(g.kind, list);
  }
  const out = ['## Links', ''];
  for (const [kind, groups] of byKind) {
    // Names calling from more than one file need full paths to tell apart.
    const filesByName = new Map<string, Set<string>>();
    for (const g of groups) {
      if (g.fromFile === '') continue;
      let s = filesByName.get(g.from);
      if (!s) filesByName.set(g.from, (s = new Set()));
      s.add(g.fromFile);
    }
    const multiFile = new Set(
      [...filesByName.entries()].filter(([, s]) => s.size > 1).map(([name]) => name),
    );
    out.push(`### ${kind}`, '');
    let shown = 0;
    for (const g of groups) {
      if (shown >= PER_KIND) break;
      out.push(renderGroup(g, multiFile));
      shown++;
    }
    const rest = groups.slice(shown).reduce((s, g) => s + g.count, 0);
    if (rest > 0) out.push(`- … and ${rest} more`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}
