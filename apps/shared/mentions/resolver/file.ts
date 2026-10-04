import { extname } from 'node:path';
import type {
  IReferenceResolver,
  ResolvedReference,
  ResolutionContext,
} from '../../../../src/mentions/types/reference.js';
import type { FmResult, ReadFileData } from '../../../../src/fm/index.js';

export interface FileResolverConsumer {
  readFile(requestedPath: string, opts?: { maxBytes?: number }): Promise<FmResult<ReadFileData>>;
}

const DEFAULT_MAX_BYTES = 100_000;
const ABSOLUTE_MAX_BYTES = 1_000_000;

const LANGUAGE_BY_EXT: Record<string, string> = {
  c: 'c',
  cpp: 'cpp',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'vue',
  yaml: 'yaml',
  yml: 'yaml',
};

function getLanguageId(absolutePath: string): string {
  return LANGUAGE_BY_EXT[extname(absolutePath).slice(1).toLowerCase()] ?? 'text';
}

export class FileReferenceResolver implements IReferenceResolver {
  readonly id = 'file';
  readonly description = 'Read a file inside the workspace (#file:path/to/file.ts)';
  readonly tool = 'read_file';

  constructor(private readonly consumer: FileResolverConsumer) {}

  async resolve(args: string, ctx: ResolutionContext): Promise<ResolvedReference> {
    const relativePath = args.trim();
    if (!relativePath) {
      return {
        id: this.id,
        name: 'file:',
        range: null,
        value: null,
        error: { message: 'Missing file path after #file:' },
      };
    }

    if (ctx.signal?.aborted) return this.aborted(relativePath);

    const absolutePath = ctx.resolvePath(relativePath);
    const maxBytes =
      ctx.tokenBudget && ctx.tokenBudget > 0
        ? Math.min(ctx.tokenBudget * 4, ABSOLUTE_MAX_BYTES)
        : DEFAULT_MAX_BYTES;

    try {
      // consumer expects requestedPath relative to workspaceRoot
      const requestedPath = relativePath;
      const result = await this.consumer.readFile(requestedPath, { maxBytes });
      if (!result.success) throw new Error(result.error.message);
      if (ctx.signal?.aborted) return this.aborted(relativePath);

      const languageId = getLanguageId(absolutePath);
      const fence = languageId
        ? `\`\`\`${languageId}\n${result.data.content}\n\`\`\``
        : `\`\`\`\n${result.data.content}\n\`\`\``;

      return {
        id: this.id,
        name: `file:${relativePath}`,
        range: null,
        value: {
          path: absolutePath,
          content: result.data.content,
          size: result.data.size,
          truncated: result.data.truncated,
        },
        modelDescription: `Content of ${relativePath}:\n${fence}${result.data.truncated ? '\n[truncated]' : ''}`,
        tool: this.tool,
      };
    } catch (err) {
      return {
        id: this.id,
        name: `file:${relativePath}`,
        range: null,
        value: null,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  private aborted(relativePath: string): ResolvedReference {
    return {
      id: this.id,
      name: `file:${relativePath}`,
      range: null,
      value: null,
      error: { message: 'Reference resolution aborted' },
    };
  }
}
