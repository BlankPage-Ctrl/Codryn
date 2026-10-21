import { applyChanges, pointerSegments, type HookChange } from './diff.js';

export interface HookWrite {
  pluginId: string;
  changes: HookChange[];
}

/**
 * `reject` keeps the original value on a contested path. `priority` lets the
 * plugin with the lowest priority number win it.
 */
export type HookConflictPolicy = 'reject' | 'priority';

export interface HookConflict {
  path: string;
  pluginIds: string[];
  /** Proposed value per plugin. */
  values: Record<string, unknown>;
}

export interface HookMergeResult {
  payload: unknown;
  applied: Array<{ pluginId: string; paths: string[] }>;
  conflicts: HookConflict[];
  dropped: Array<{ pluginId: string; paths: string[] }>;
}

/** Returns the plugin whose value wins, or null to keep the original. */
export type HookConflictResolver = (conflict: HookConflict) => string | null;

interface Claim {
  pluginId: string;
  path: string;
  segments: string[];
  change: HookChange;
}

function overlaps(left: string[], right: string[]): boolean {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function groupClaims(claims: Claim[]): Claim[][] {
  const parent = claims.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  for (let left = 0; left < claims.length; left += 1) {
    for (let right = left + 1; right < claims.length; right += 1) {
      if (!overlaps(claims[left].segments, claims[right].segments)) continue;
      union(left, right);
    }
  }

  const groups = new Map<number, Claim[]>();
  for (let index = 0; index < claims.length; index += 1) {
    const root = find(index);
    const group = groups.get(root);
    if (group) {
      group.push(claims[index]);
      continue;
    }
    groups.set(root, [claims[index]]);
  }
  return [...groups.values()];
}

/**
 * Merges the writes of several plugins into the payload.
 *
 * Every plugin saw the same snapshot, so a contested path is a real conflict
 * and never a silent overwrite: the policy decides, and the loser keeps only
 * the paths nobody else touched.
 */
export function mergeHookWrites(
  snapshot: unknown,
  writes: HookWrite[],
  policy: HookConflictPolicy,
  priorityOf: (pluginId: string) => number,
  resolve?: HookConflictResolver,
): HookMergeResult {
  const claims: Claim[] = [];
  for (const write of writes) {
    for (const change of write.changes) {
      claims.push({
        pluginId: write.pluginId,
        path: change.path,
        segments: pointerSegments(change.path),
        change,
      });
    }
  }

  const applied = new Map<string, string[]>();
  const dropped = new Map<string, string[]>();
  const conflicts: HookConflict[] = [];
  const winners: Claim[] = [];

  const keep = (claim: Claim): void => {
    winners.push(claim);
    const paths = applied.get(claim.pluginId) ?? [];
    paths.push(claim.path);
    applied.set(claim.pluginId, paths);
  };
  const drop = (claim: Claim): void => {
    const paths = dropped.get(claim.pluginId) ?? [];
    paths.push(claim.path);
    dropped.set(claim.pluginId, paths);
  };

  for (const group of groupClaims(claims)) {
    const pluginIds = [...new Set(group.map((claim) => claim.pluginId))];
    if (pluginIds.length === 1) {
      for (const claim of group) keep(claim);
      continue;
    }

    const values: Record<string, unknown> = {};
    for (const claim of group) {
      if (!(claim.pluginId in values)) values[claim.pluginId] = claim.change.value;
    }
    const conflict: HookConflict = { path: group[0].path, pluginIds: pluginIds.sort(), values };
    conflicts.push(conflict);

    let winner: string | null = null;
    if (policy === 'priority') {
      winner = [...group].sort((left, right) => {
        const byPriority = priorityOf(left.pluginId) - priorityOf(right.pluginId);
        if (byPriority !== 0) return byPriority;
        return left.pluginId.localeCompare(right.pluginId);
      })[0].pluginId;
    } else if (resolve) {
      winner = resolve(conflict);
    }

    for (const claim of group) {
      if (winner && claim.pluginId === winner) {
        keep(claim);
        continue;
      }
      drop(claim);
    }
  }

  const payload = applyChanges(
    snapshot,
    winners.map((claim) => claim.change),
  );

  return {
    payload,
    applied: [...applied.entries()].map(([pluginId, paths]) => ({ pluginId, paths })),
    conflicts,
    dropped: [...dropped.entries()].map(([pluginId, paths]) => ({ pluginId, paths })),
  };
}
