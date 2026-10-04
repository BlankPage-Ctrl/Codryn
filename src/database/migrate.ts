import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBunRuntime, normalizeDatabaseFilename } from './database.manager.js';

export function resolveMigrationsFolder(): string | null {
  // Binary distribution: `make build-backend` stages drizzle/ next to the
  // compiled executable, whose module URL lives on the virtual $bunfs path
  // (no drizzle sibling there). Probe the executable directory first.
  const execCand = path.join(path.dirname(process.execPath), 'drizzle');
  if (fs.existsSync(path.join(execCand, 'meta', '_journal.json'))) {
    return execCand;
  }

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const cand = path.join(dir, 'drizzle');
    if (fs.existsSync(path.join(cand, 'meta', '_journal.json'))) {
      return cand;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function runMigrations(dbPath: string): Promise<void> {
  const folder = resolveMigrationsFolder();
  if (!folder) {
    return;
  }
  const filename = normalizeDatabaseFilename(dbPath);
  if (isBunRuntime()) {
    const [{ Database: BunDatabase }, { drizzle: drizzleBun }, { migrate: migrateBun }] =
      await Promise.all([
        import('bun:sqlite'),
        import('drizzle-orm/bun-sqlite'),
        import('drizzle-orm/bun-sqlite/migrator'),
      ]);
    const sqlite = new BunDatabase(filename);
    try {
      migrateBun(drizzleBun(sqlite), { migrationsFolder: folder });
    } finally {
      sqlite.close();
    }
    return;
  }
  const [{ default: SqliteDatabase }, { drizzle: drizzleBetter }, { migrate: migrateBetter }] =
    await Promise.all([
      import('better-sqlite3'),
      import('drizzle-orm/better-sqlite3'),
      import('drizzle-orm/better-sqlite3/migrator'),
    ]);
  const sqlite = new SqliteDatabase(filename);
  try {
    migrateBetter(drizzleBetter(sqlite), { migrationsFolder: folder });
  } finally {
    sqlite.close();
  }
}
