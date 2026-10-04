/**
 * Awakening section: who wakes when a hot symbol is edited.
 * Insight nodes carry no test titles, so breakers fall back to
 * name@file:site (call-site line when known).
 */

import type { InsightTraceReport } from '../../types.js';
import type { Wash } from './wash.js';

export const AWAKE_MAX_SYMBOLS = 5;
const AWAKE_MAX_BREAKERS = 5;

export function renderAwakening(rep: InsightTraceReport, wash: Wash): string {
  const hot = wash.rows.filter((r) => r.wakeTotal > 0).slice(0, AWAKE_MAX_SYMBOLS);
  if (hot.length === 0) return '';
  const out = ['## Awakening', ''];
  for (const row of hot) {
    out.push(`### ${row.name} (${row.file}:${row.line}) — ${row.callers} wake`, '');
    const rowNode = rep.nodes.find((x) => x.id === row.id);
    const siteOf = new Map(
      (rowNode?.calledBy ?? []).map(
        (c) => [c.id, c.siteRange?.start ?? c.lineRange.start] as const,
      ),
    );
    const shown = row.breakerIds.slice(0, AWAKE_MAX_BREAKERS);
    for (const id of shown) {
      const n = rep.nodes.find((x) => x.id === id);
      const at = siteOf.get(id) ?? n?.lineRange.start ?? 0;
      if (n?.testTitle) {
        out.push(`- "${n.testTitle}" (${n.filePath}:${at}) calls ${row.name}`);
      } else if (n) {
        out.push(`- ${n.name}@${n.filePath}:${at} calls ${row.name}`);
      } else {
        out.push(`- ${id} calls ${row.name}`);
      }
    }
    const rest = Math.max(0, row.wakeTotal - shown.length);
    if (rest > 0) out.push(`- … and ${rest} more wake`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}
