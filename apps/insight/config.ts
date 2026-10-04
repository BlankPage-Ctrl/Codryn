import path from 'node:path';
import { findInsightBinary } from './binary.js';
import { INSIGHT_BINARY_FALLBACK, INSIGHT_DB_NAME, INSIGHT_DIR_REL } from './constants.js';

export function resolveInsightPaths(
  projectPath: string,
  customFolder?: string,
): { dir: string; db: string; root: string } {
  const root = path.resolve(projectPath);
  const dir = customFolder
    ? path.isAbsolute(customFolder)
      ? path.resolve(customFolder)
      : path.resolve(root, customFolder)
    : path.resolve(root, INSIGHT_DIR_REL);
  const db = path.join(dir, INSIGHT_DB_NAME);
  return { root, dir, db };
}

export function resolveInsightBinary(
  override?: string,
  envBinary?: string,
  projectRoot?: string,
): string {
  const found = findInsightBinary({
    override,
    envBinary,
    cwd: projectRoot ?? process.cwd(),
  });
  if (found) return found.path;
  const base = projectRoot ? path.resolve(projectRoot) : process.cwd();
  // legacy fallback - caller should prefer ensureInsightBinary() for a clear not-found error
  return path.resolve(base, INSIGHT_BINARY_FALLBACK);
}
