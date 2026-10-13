import ignore from 'ignore';
import type { IIgnoreFilter } from '../types/ignore.js';
import { isOutsideDisplayPath } from '../utils/path.js';

export class IgnoreFilter implements IIgnoreFilter {
  readonly patterns: readonly string[];

  private readonly matcher: ignore.Ignore;

  constructor(patterns: readonly string[] = []) {
    this.patterns = [...patterns];
    this.matcher = ignore();
    if (this.patterns.length > 0) {
      this.matcher.add([...this.patterns]);
    }
  }

  ignores(relPath: string, isDirectory: boolean): boolean {
    const normalized = relPath === '' ? '/' : relPath;
    // `ignore` throws on paths that escaped the base. Paths outside the
    // workspace root are never wanted, so report them as ignored.
    if (isOutsideDisplayPath(normalized)) return true;
    if (this.matcher.ignores(normalized)) return true;
    if (isDirectory && this.matcher.ignores(`${normalized}/`)) return true;
    return false;
  }
}
