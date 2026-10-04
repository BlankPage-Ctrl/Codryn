export const DEFAULT_GRAPH_REF_LIMIT = 12;
export const MAX_GRAPH_REF_LIMIT = 30;

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;

export function clampRefLimit(v: number | undefined): number {
  const n = Math.round(v ?? DEFAULT_GRAPH_REF_LIMIT);
  return Math.min(Math.max(1, n), MAX_GRAPH_REF_LIMIT);
}

export function clampSearchLimit(v: number | undefined): number {
  const n = Math.round(v ?? DEFAULT_SEARCH_LIMIT);
  return Math.min(Math.max(1, n), MAX_SEARCH_LIMIT);
}
