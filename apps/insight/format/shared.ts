import type { InsightFunctionRef } from '../types.js';

export type InsightScopeFilter = Array<'internal' | 'external' | 'unresolved'>;

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function safeName(name: string): string {
  return name.replace(/`/g, "'");
}

export function escTick(s: string): string {
  return s.replace(/`/g, "'");
}

export function isInternalScope(scope?: string): boolean {
  return scope != null && scope.startsWith('internal');
}

export function isExternalScope(scope?: string): boolean {
  return scope != null && scope.startsWith('external');
}

export function isUnresolvedScope(scope?: string): boolean {
  return scope === 'unresolved' || scope == null || scope === '';
}

export function scopeTag(ref: InsightFunctionRef): string {
  if (!ref.scope) return 'unresolved';
  return escTick(ref.scope);
}

export function matchesScopeFilter(ref: InsightFunctionRef, filter?: InsightScopeFilter): boolean {
  if (!filter || filter.length === 0) return true;
  const s = ref.scope ?? 'unresolved';
  for (const f of filter) {
    if (f === 'internal' && isInternalScope(s)) return true;
    if (f === 'external' && isExternalScope(s)) return true;
    if (f === 'unresolved' && isUnresolvedScope(s)) return true;
  }
  return false;
}
