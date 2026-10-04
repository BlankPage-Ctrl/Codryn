import ignore from 'ignore';
import type { IIgnoreFilter } from '../types/ignore.js';

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
    if (this.matcher.ignores(normalized)) return true;
    if (isDirectory && this.matcher.ignores(`${normalized}/`)) return true;
    return false;
  }
}
