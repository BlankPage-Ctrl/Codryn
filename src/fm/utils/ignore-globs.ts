/**
 * Best-effort translation of a gitignore-syntax pattern to `rg --glob`
 * exclusions. `rg` globs match `cwd`-relative paths, so a bare name must be
 * expanded to any-depth forms to mirror `ignore`-package semantics.
 */
export function toIgnoreGlobs(pattern: string): string[] {
  const trimmed = pattern.trim().replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '!') return [];
  const negated = trimmed.startsWith('!');
  const body = negated ? trimmed.slice(1) : trimmed;
  const unrooted = body.startsWith('/') ? body.slice(1) : body;
  const deny = negated ? '' : '!';
  if (unrooted.includes('/') || unrooted.includes('*')) {
    return [`${deny}${unrooted}`, `${deny}${unrooted}/**`];
  }
  return [`${deny}**/${unrooted}`, `${deny}**/${unrooted}/**`];
}
