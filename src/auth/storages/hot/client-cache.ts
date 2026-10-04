import type { ClientRow } from '../../schemas/client.js';
import type { IHotClientStorage } from '../../types/hot-client-storage.js';

interface CacheEntry {
  data: ClientRow;
  expiresAt: number;
}

export class HotClientStorage implements IHotClientStorage {
  private cache = new Map<string, CacheEntry>();
  private readonly defaultTtlMs: number;
  private readonly maxSize: number;

  constructor(options?: { ttlMs?: number; maxSize?: number }) {
    this.defaultTtlMs = options?.ttlMs ?? 5 * 60 * 1000;
    this.maxSize = options?.maxSize ?? 1000;
  }

  async get(clientId: string): Promise<ClientRow | null> {
    const entry = this.cache.get(clientId);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(clientId);
      return null;
    }

    return entry.data;
  }

  async set(clientId: string, row: ClientRow): Promise<void> {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(clientId, {
      data: row,
      expiresAt: Date.now() + this.defaultTtlMs,
    });
  }

  async delete(clientId: string): Promise<void> {
    this.cache.delete(clientId);
  }

  async has(clientId: string): Promise<boolean> {
    const entry = this.cache.get(clientId);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(clientId);
      return false;
    }

    return true;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
