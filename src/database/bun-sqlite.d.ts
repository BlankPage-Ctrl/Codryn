/**
 * Minimal ambient types for the built-in `bun:sqlite` module.
 * Only loaded through a lazy `import("bun:sqlite")` on the Bun runtime;
 * Node.js never touches this module. Kept minimal on purpose: the full
 * driver surface is consumed through drizzle-orm, not directly.
 */
declare module 'bun:sqlite' {
  export class Database {
    constructor(filename?: string, options?: { readonly?: boolean; create?: boolean });
    exec(source: string): void;
    close(throwOnError?: boolean): void;
  }
}
