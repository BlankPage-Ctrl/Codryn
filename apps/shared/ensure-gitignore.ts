import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from '../../src/fm/utils/mutex.js';

export const CODRYN_GITIGNORE_ENTRY = '.codryn/';
const GITIGNORE_FILE = '.gitignore';
const MARKER_COMMENT = '# Codryn workspace';

/**
 * Ensure the workspace root `.gitignore` ignores `.codryn/`.
 * Creates the file when missing, appends otherwise. Idempotent.
 * Only manages the `.codryn/` entry, never touches other patterns.
 */
export async function ensureCodrynGitignored(projectPath: string): Promise<{ added: boolean }> {
  const abs = join(projectPath, GITIGNORE_FILE);
  return withFileLock(abs, async () => {
    let existing: string | null = null;
    try {
      existing = await readFile(abs, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    if (existing === null) {
      await writeFile(abs, `${MARKER_COMMENT}\n${CODRYN_GITIGNORE_ENTRY}\n`, 'utf-8');
      return { added: true };
    }

    if (hasCodrynEntry(existing)) return { added: false };

    const suffix = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
    await writeFile(
      abs,
      `${existing}${suffix}${MARKER_COMMENT}\n${CODRYN_GITIGNORE_ENTRY}\n`,
      'utf-8',
    );
    return { added: true };
  });
}

function hasCodrynEntry(content: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      trimmed === '.codryn' ||
      trimmed === '.codryn/' ||
      trimmed === '.codryn/*' ||
      trimmed === '/.codryn' ||
      trimmed === '/.codryn/' ||
      trimmed === '/.codryn/*'
    ) {
      return true;
    }
  }
  return false;
}
