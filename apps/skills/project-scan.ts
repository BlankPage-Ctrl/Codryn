import path from 'node:path';
import {
  FileType,
  ListDirService,
  ReadFileService,
  type FileRepository,
} from '../../src/fm/index.js';
import { parseSkillFile } from './parser.js';
import type { ProjectSkillPort, SkillDirEntry, SkillMeta } from './types.js';
import { SKILL_FILENAME } from './scanner.js';

const MAX_SCAN_DEPTH = 6;
const MAX_SKILL_FILE_BYTES = 1_000_000;

const NEVER_DESCEND = new Set(['node_modules', '.git', 'dist', 'build', '.next']);

function shouldDescend(name: string): boolean {
  if (NEVER_DESCEND.has(name)) return false;
  if (name.startsWith('.')) return false;
  return true;
}

/**
 * Because `resolveSafePath` throws `PathTraversalError` outside the scoped
 * root, every path touched here is provably inside the skill dir - the
 * containment that disqualified `fm-services` for global/walk-up scanning
 * becomes the security guarantee for project scanning.
 */
export function toProjectSkillPort(fileRepo: FileRepository, skillDir: string): ProjectSkillPort {
  const root = path.resolve(skillDir);
  const listDirService = new ListDirService(fileRepo, root);
  const readFileService = new ReadFileService(fileRepo, root);

  return {
    root,
    async listDir(rel: string): Promise<SkillDirEntry[] | null> {
      const result = await listDirService.listDir(rel);
      if (!result.success) return null; // missing dir -> empty, not an error.
      return result.data.nodes.map((node) => ({
        name: node.name,
        isDirectory: node.type === FileType.DIRECTORY,
      }));
    },
    async readFile(rel: string): Promise<string | null> {
      const result = await readFileService.readFile(rel, {
        maxBytes: MAX_SKILL_FILE_BYTES,
        withLineNumbers: false,
      });
      if (!result.success) return null;
      if (result.data.encoding !== 'utf-8') return null;
      return result.data.content;
    },
  };
}

export async function scanProjectSkillFiles(port: ProjectSkillPort): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ rel: string; depth: number }> = [{ rel: '.', depth: 0 }];

  while (queue.length > 0) {
    const { rel, depth } = queue.shift()!;
    if (depth > MAX_SCAN_DEPTH) continue;
    const entries = await port.listDir(rel);
    if (!entries) continue; // missing/unreadable - skip silent.
    for (const entry of entries) {
      const child = rel === '.' ? entry.name : `${rel}/${entry.name}`;
      if (!entry.isDirectory && entry.name === SKILL_FILENAME) {
        out.push(child);
        continue;
      }
      if (entry.isDirectory && shouldDescend(entry.name)) {
        queue.push({ rel: child, depth: depth + 1 });
      }
    }
  }

  return [...new Set(out)];
}

export async function loadProjectSkills(
  port: ProjectSkillPort,
): Promise<Array<SkillMeta & { content: string }>> {
  const files = await scanProjectSkillFiles(port);
  const loaded: Array<SkillMeta & { content: string }> = [];
  for (const rel of files) {
    const raw = await port.readFile(rel);
    if (raw == null) continue; // deleted/unreadable between scan and load.
    let parsed;
    try {
      parsed = parseSkillFile(raw, path.join(port.root, rel));
    } catch {
      continue;
    }
    if (parsed) loaded.push(parsed);
  }
  return loaded;
}
