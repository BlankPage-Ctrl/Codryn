export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  size(): number;
}

export function createTtlCache<V>(opts: { ttlMs: number; max?: number }): TtlCache<V> {
  const max = opts.max ?? 64;
  const store = new Map<string, { value: V; expiresAt: number }>();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      // Re-insert so Map iteration order tracks most-recent use for eviction.
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      store.set(key, { value, expiresAt: Date.now() + opts.ttlMs });
      while (store.size > max) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}

export interface Cooldown {
  block(id: string, ms?: number): void;
  isCoolingDown(id: string): boolean;
  remainingMs(id: string): number;
  clear(): void;
}

export function createCooldown(defaultMs: number): Cooldown {
  const blockedUntil = new Map<string, number>();

  return {
    block(id, ms) {
      blockedUntil.set(id, Date.now() + (ms ?? defaultMs));
    },
    isCoolingDown(id) {
      const until = blockedUntil.get(id);
      if (until === undefined) return false;
      if (until > Date.now()) return true;
      blockedUntil.delete(id);
      return false;
    },
    remainingMs(id) {
      const until = blockedUntil.get(id);
      if (until === undefined) return 0;
      return Math.max(0, until - Date.now());
    },
    clear() {
      blockedUntil.clear();
    },
  };
}
