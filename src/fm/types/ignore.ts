import { z } from 'zod';

/**
 * Raw ignore patterns in gitignore syntax, as read from `.gitignore`
 * (or sister files) by the consumer layer (`apps/`).
 * `src/fm` never reads ignore files itself - it only receives this data.
 */
export const IgnorePatternsSchema = z.array(z.string().min(1).max(500)).max(2000);

export type IgnorePatterns = z.infer<typeof IgnorePatternsSchema>;

export const IgnoreOptionsSchema = z.object({
  ignorePatterns: IgnorePatternsSchema.optional(),
});

export type IgnoreOptions = z.infer<typeof IgnoreOptionsSchema>;

/** Built-in defaults (gitignore syntax). Always applied on top of workspace patterns. */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = ['node_modules/', '.git/', '.codryn/'];

/** Pure predicate over workspace-relative paths. Implemented in `engines/ignore.ts`. */
export interface IIgnoreFilter {
  readonly patterns: readonly string[];
  ignores(relPath: string, isDirectory: boolean): boolean;
}
