import type { ReadFileService } from '../../src/fm/index.js';

const GITIGNORE_FILES = ['.gitignore', '.git/info/exclude'] as const;

const MAX_GITIGNORE_BYTES = 256 * 1024;

export function parseGitignoreContent(content: string): string[] {
  const patterns: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    patterns.push(trimmed);
  }
  return [...new Set(patterns)];
}

export async function loadGitignorePatterns(
  readFile: Pick<ReadFileService, 'readFile'>,
): Promise<string[]> {
  const patterns: string[] = [];
  for (const file of GITIGNORE_FILES) {
    const result = await readFile.readFile(file, {
      maxBytes: MAX_GITIGNORE_BYTES,
      withLineNumbers: false,
    });
    if (!result.success) {
      if (result.error.code === 'PATH_NOT_FOUND' || result.error.code === 'NOT_A_FILE') continue;
      throw new Error(`Failed to read "${file}": ${result.error.message}`);
    }
    if (result.data.encoding !== 'utf-8') continue;
    patterns.push(...parseGitignoreContent(result.data.content));
  }
  return [...new Set(patterns)];
}
