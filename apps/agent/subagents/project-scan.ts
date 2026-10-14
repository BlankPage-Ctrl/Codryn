import path from 'node:path';
import {
  FileType,
  ListDirService,
  ReadFileService,
  type FileRepository,
} from '../../../src/fm/index.js';
import { MAX_FILE_BYTES, parseSubAgentFile } from './parser.js';
import type { SubAgentDef } from './types.js';

/** Containment-scoped port over `<project>/.codryn/agents`. Flat layout, top-level `*.md` only. */
export interface SubAgentPort {
  root: string;
  listDir(rel: string): Promise<Array<{ name: string; isDirectory: boolean }> | null>;
  readFile(rel: string): Promise<string | null>;
}

export function toSubAgentPort(fileRepo: FileRepository, agentsDir: string): SubAgentPort {
  const root = path.resolve(agentsDir);
  const listDirService = new ListDirService(fileRepo, root);
  const readFileService = new ReadFileService(fileRepo, root);
  return {
    root,
    async listDir(rel: string) {
      const result = await listDirService.listDir(rel);
      if (!result.success) return null;
      return result.data.nodes.map((node) => ({
        name: node.name,
        isDirectory: node.type === FileType.DIRECTORY,
      }));
    },
    async readFile(rel: string) {
      const result = await readFileService.readFile(rel, {
        maxBytes: MAX_FILE_BYTES,
        withLineNumbers: false,
      });
      if (!result.success || result.data.encoding !== 'utf-8') return null;
      return result.data.content;
    },
  };
}

export async function loadProjectSubAgents(
  port: SubAgentPort,
): Promise<Array<{ def: SubAgentDef; rel: string }>> {
  const entries = await port.listDir('.');
  if (!entries) return [];
  const out: Array<{ def: SubAgentDef; rel: string }> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory || !entry.name.endsWith('.md')) continue;
    const raw = await port.readFile(entry.name);
    if (raw == null) continue;
    try {
      const def = parseSubAgentFile(raw, path.join(port.root, entry.name));
      if (def) out.push({ def, rel: entry.name });
    } catch {
      continue;
    }
  }
  return out;
}
