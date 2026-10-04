import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import PQueue from 'p-queue';

export type Database =
  BetterSQLite3Database<Record<string, unknown>> | BunSQLiteDatabase<Record<string, unknown>>;

export function isBunRuntime(): boolean {
  return typeof (globalThis as Record<string, unknown>).Bun !== 'undefined';
}

/**
 * Normalize a configured database location into a driver filename.
 * Only local files (and `:memory:`) are supported; remote URLs are rejected
 * with a clear error instead of failing obscurely inside the driver.
 */
export function normalizeDatabaseFilename(raw: string): string {
  const filename = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  if (filename !== ':memory:' && filename.includes('://')) {
    throw new Error(
      `Remote database URLs are not supported (got "${raw}"). Use a local file path or ":memory:".`,
    );
  }
  return filename;
}

interface SqliteHandle {
  checkpoint(): void;
  close(): void;
}

export class DatabaseManager<S extends Record<string, unknown>> {
  private handle: SqliteHandle | null = null;
  private db: Database | null = null;
  private readonly queue = new PQueue({ concurrency: 1 });

  constructor(
    private schema: S,
    private filename: string,
  ) {}

  async init(): Promise<Database> {
    const filename = normalizeDatabaseFilename(this.filename);
    if (filename !== ':memory:') {
      mkdirSync(dirname(filename), { recursive: true });
    }
    if (isBunRuntime()) {
      const [{ Database: BunDatabase }, { drizzle: drizzleBun }] = await Promise.all([
        import('bun:sqlite'),
        import('drizzle-orm/bun-sqlite'),
      ]);
      const sqlite = new BunDatabase(filename);
      sqlite.exec('PRAGMA journal_mode = WAL;');
      sqlite.exec('PRAGMA busy_timeout = 5000;');
      sqlite.exec('PRAGMA synchronous = NORMAL;');
      this.handle = {
        checkpoint: () => {
          sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        },
        close: () => sqlite.close(),
      };
      // SAFE: both union members expose the same sqlite-core query surface;
      // the alias only needs what storages consume (select/insert/update/delete/transaction).
      this.db = drizzleBun(sqlite, { schema: this.schema }) as Database;
    } else {
      const [{ default: SqliteDatabase }, { drizzle: drizzleBetter }] = await Promise.all([
        import('better-sqlite3'),
        import('drizzle-orm/better-sqlite3'),
      ]);
      const sqlite = new SqliteDatabase(filename);
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('busy_timeout = 5000');
      sqlite.pragma('synchronous = NORMAL');
      this.handle = {
        checkpoint: () => {
          sqlite.pragma('wal_checkpoint(TRUNCATE)');
        },
        close: () => sqlite.close(),
      };
      // SAFE: same as above; better-sqlite3 and bun:sqlite share the sqlite-core API.
      this.db = drizzleBetter(sqlite, { schema: this.schema }) as Database;
    }
    return this.db;
  }

  getQueue(): PQueue {
    return this.queue;
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.add(fn) as Promise<T>;
  }

  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  async checkpoint() {
    await this.queue.onIdle();
    this.handle?.checkpoint();
  }

  async close() {
    await this.queue.onIdle();
    this.handle?.close();
    this.handle = null;
    this.db = null;
  }
}
