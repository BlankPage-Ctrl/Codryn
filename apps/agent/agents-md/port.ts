import path from 'node:path';
import { ReadFileService, type FileRepository } from '../../../src/fm/index.js';
import type { AgentsMdFile, AgentsMdPort } from './types.js';

const MAX_AGENTS_MD_BYTES = 24 * 1024;

// Reads stay inside projectPath via ReadFileService scoping.
export function toAgentsMdPort(fileRepo: FileRepository, projectPath: string): AgentsMdPort {
  const root = path.resolve(projectPath);
  const reader = new ReadFileService(fileRepo, root);

  return {
    root,
    async readFile(rel: string): Promise<AgentsMdFile | null> {
      const result = await reader.readFile(rel, {
        maxBytes: MAX_AGENTS_MD_BYTES,
        withLineNumbers: false,
      });
      if (!result.success) return null;
      if (result.data.encoding !== 'utf-8') return null;
      return { content: result.data.content, truncated: result.data.truncated ?? false };
    },
  };
}
