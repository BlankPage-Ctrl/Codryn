/** Which renderer the budget serves. Search renders hits + code and gets a looser envelope than trace. */
export type RenderFlavor = 'trace' | 'search';

export interface Tier {
  maxOutputChars: number;
  defaultMaxFiles: number;
  maxCharsPerFile: number;
  gapThreshold: number;
  /** Absolute ceiling for the final markdown (applied over HARD_MULT below). */
  hardMax: number;
}

export const TRACE_HARD_MAX = 40000;
export const SEARCH_HARD_MAX = 60000;

const HARD_MULT = 1.5;

/** Tier by indexed file count. Larger tiers never allow less per file. */
export function pickTier(fileCount: number, flavor: RenderFlavor = 'trace'): Tier {
  if (flavor === 'search') {
    if (fileCount < 150) {
      return {
        maxOutputChars: 36000,
        defaultMaxFiles: 8,
        maxCharsPerFile: 8000,
        gapThreshold: 8,
        hardMax: SEARCH_HARD_MAX,
      };
    }
    if (fileCount < 500) {
      return {
        maxOutputChars: 45000,
        defaultMaxFiles: 10,
        maxCharsPerFile: 9000,
        gapThreshold: 10,
        hardMax: SEARCH_HARD_MAX,
      };
    }
    if (fileCount < 5000) {
      return {
        maxOutputChars: 54000,
        defaultMaxFiles: 12,
        maxCharsPerFile: 10000,
        gapThreshold: 12,
        hardMax: SEARCH_HARD_MAX,
      };
    }
    return {
      maxOutputChars: 54000,
      defaultMaxFiles: 12,
      maxCharsPerFile: 11000,
      gapThreshold: 15,
      hardMax: SEARCH_HARD_MAX,
    };
  }
  if (fileCount < 150) {
    return {
      maxOutputChars: 24000,
      defaultMaxFiles: 5,
      maxCharsPerFile: 6000,
      gapThreshold: 7,
      hardMax: TRACE_HARD_MAX,
    };
  }
  if (fileCount < 500) {
    return {
      maxOutputChars: 30000,
      defaultMaxFiles: 6,
      maxCharsPerFile: 7000,
      gapThreshold: 8,
      hardMax: TRACE_HARD_MAX,
    };
  }
  if (fileCount < 5000) {
    return {
      maxOutputChars: 36000,
      defaultMaxFiles: 10,
      maxCharsPerFile: 8000,
      gapThreshold: 12,
      hardMax: TRACE_HARD_MAX,
    };
  }
  return {
    maxOutputChars: 36000,
    defaultMaxFiles: 10,
    maxCharsPerFile: 9000,
    gapThreshold: 15,
    hardMax: TRACE_HARD_MAX,
  };
}

/** Absolute ceiling for the final markdown: envelope headroom capped by the flavor's hard max. */
export function hardCeiling(tier: Tier): number {
  return Math.min(Math.round(tier.maxOutputChars * HARD_MULT), tier.hardMax);
}

export interface ShareInput {
  path: string;
  /** Relevance of the file to the ask. */
  score: number;
  /** How much its bytes teach: 0..1 after path penalties. */
  worth: number;
  /** Carries a trail step - the answer itself, never cliffed. */
  spine: boolean;
  /** Query named this file - funded first, never cliffed. */
  named?: boolean;
}

export interface SharePlan {
  /** path -> source chars it may render. */
  allowances: Map<string, number>;
  /** Zeroed files, rank order - pointers, not bytes. */
  cliffed: string[];
}

const CLIFF_SHARE = 0.15;
const CLIFF_MAX = 10;
const MIN_CHARS = 700;
const MAX_SHARE = 0.7;
const FILE_OVERHEAD = 200;
const SPINE_BOOST = 2;

/**
 * Split the tier envelope across ranked candidates.
 * Candidates must arrive in final rank order.
 */
export function splitBudget(
  candidates: readonly ShareInput[],
  tier: Tier,
  maxFiles: number,
): SharePlan {
  const empty: SharePlan = { allowances: new Map(), cliffed: [] };
  if (candidates.length === 0) return empty;

  const weightOf = (c: ShareInput): number => {
    const w =
      Math.max(0, c.score) * Math.max(0, Math.min(1, c.worth)) * (c.spine ? SPINE_BOOST : 1);
    return Number.isFinite(w) ? w : 0;
  };

  // Named files weigh at least as much as the strongest candidate: a pure
  // path token carries no text score, yet the file IS the answer.
  const raw = new Map(candidates.map((c) => [c.path, weightOf(c)]));
  const topRaw = Math.max(...raw.values());
  const weights = new Map(
    candidates.map((c) => [
      c.path,
      c.named ? Math.max(raw.get(c.path) ?? 0, topRaw, 1) : (raw.get(c.path) ?? 0),
    ]),
  );
  const top = Math.max(...weights.values());
  if (!(top > 0)) return empty;

  // Cliff before maxFiles so a freed slot hands down to the next file.
  const cliffAt = Math.min(top * CLIFF_SHARE, CLIFF_MAX);
  const cliffed: string[] = [];
  let admitted = candidates.filter((c) => {
    if (!c.spine && !c.named && (weights.get(c.path) ?? 0) < cliffAt) {
      cliffed.push(c.path);
      return false;
    }
    return true;
  });
  if (admitted.length === 0) {
    admitted = [candidates[0]!];
    cliffed.splice(cliffed.indexOf(candidates[0]!.path), 1);
  }
  for (const c of admitted.slice(maxFiles)) cliffed.push(c.path);
  admitted = admitted.slice(0, maxFiles);

  // Serve few files well: the envelope must afford MIN_CHARS each.
  const affordable = Math.max(1, Math.floor(tier.maxOutputChars / (MIN_CHARS + FILE_OVERHEAD)));
  if (admitted.length > affordable) {
    const byWeight = [...admitted].sort(
      (a, b) => (weights.get(b.path) ?? 0) - (weights.get(a.path) ?? 0),
    );
    const keep = new Set(byWeight.slice(0, affordable).map((c) => c.path));
    for (const c of admitted) if (c.spine || c.named) keep.add(c.path);
    admitted = admitted.filter((c) => {
      if (!keep.has(c.path)) {
        cliffed.push(c.path);
        return false;
      }
      return true;
    });
  }

  const allowances = new Map<string, number>();
  const pool = Math.max(0, tier.maxOutputChars - FILE_OVERHEAD * admitted.length);
  const total = admitted.reduce((s, c) => s + (weights.get(c.path) ?? 0), 0);
  if (total <= 0) return { allowances, cliffed };
  const ceiling = Math.round(tier.maxOutputChars * MAX_SHARE);
  const floors = Math.min(pool, MIN_CHARS * admitted.length);
  const remainder = Math.max(0, pool - floors);
  for (const c of admitted) {
    const share =
      Math.floor(floors / admitted.length) +
      Math.floor((remainder * (weights.get(c.path) ?? 0)) / total);
    allowances.set(c.path, Math.min(share, ceiling));
  }
  return { allowances, cliffed };
}
