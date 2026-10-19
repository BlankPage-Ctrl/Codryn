/**
 * Predicate over a path. True means reading the target requires approval.
 * `src/fm` only receives the pattern list; the defaults live in `apps/`.
 */
export interface ISensitiveMatcher {
  isSensitive(targetPath: string): boolean;
}
