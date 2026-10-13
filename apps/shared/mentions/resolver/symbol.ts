import { extname } from 'node:path';
import type {
  IReferenceResolver,
  ResolvedReference,
  ResolutionContext,
} from '../../../../src/mentions/types/reference.js';
import { isFmPendingApproval, type FmOutcome } from '../../../../src/fm/types/permission.js';
import type { ReadFileData } from '../../../../src/fm/index.js';

export interface SymbolTarget {
  id: string;
  name: string;
  qualifiedName?: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
}

export interface SymbolResolverConsumer {
  lookup(id: string): Promise<SymbolTarget>;
  readFile(
    requestedPath: string,
    opts?: { maxBytes?: number; startLine?: number; endLine?: number; withLineNumbers?: boolean },
  ): Promise<FmOutcome<ReadFileData>>;
}

const DEFAULT_MAX_BYTES = 100_000;
const ABSOLUTE_MAX_BYTES = 1_000_000;
const MAX_SYMBOL_LINES = 120;

const LANGUAGE_BY_EXT: Record<string, string> = {
  go: 'go',
  py: 'python',
  pyi: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  vue: 'vue',
};

function getLanguageId(filePath: string): string {
  return LANGUAGE_BY_EXT[extname(filePath).slice(1).toLowerCase()] ?? 'text';
}

export class SymbolReferenceResolver implements IReferenceResolver {
  readonly id = 'symbol';
  readonly description = 'Show a code symbol inside the workspace (#symbol:<insight-id>)';
  readonly tool = 'read_file';

  constructor(private readonly consumer: SymbolResolverConsumer) {}

  async resolve(args: string, ctx: ResolutionContext): Promise<ResolvedReference> {
    const symbolId = args.trim();
    if (!symbolId) {
      return {
        id: this.id,
        name: 'symbol:',
        range: null,
        value: null,
        error: { message: 'Missing symbol id after #symbol:' },
      };
    }

    if (ctx.signal?.aborted) return this.aborted(symbolId);

    let target: SymbolTarget;
    try {
      target = await this.consumer.lookup(symbolId);
    } catch (err) {
      return {
        id: this.id,
        name: `symbol:${symbolId}`,
        range: null,
        value: null,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
    if (ctx.signal?.aborted) return this.aborted(symbolId);

    const startLine = Math.max(1, Math.round(target.startLine) || 1);
    const rawEnd = Math.max(startLine, Math.round(target.endLine) || startLine);
    const endLine = Math.min(rawEnd, startLine + MAX_SYMBOL_LINES - 1);
    const rangeCapped = rawEnd !== endLine;

    const maxBytes =
      ctx.tokenBudget && ctx.tokenBudget > 0
        ? Math.min(ctx.tokenBudget * 4, ABSOLUTE_MAX_BYTES)
        : DEFAULT_MAX_BYTES;

    try {
      const result = await this.consumer.readFile(target.filePath, {
        startLine,
        endLine,
        maxBytes,
        withLineNumbers: false,
      });
      if (isFmPendingApproval(result)) {
        return {
          id: this.id,
          name: `symbol:${symbolId}`,
          range: null,
          value: null,
          error: { message: `Symbol is outside the workspace: ${target.filePath}` },
        };
      }
      if (!result.success) throw new Error(result.error.message);
      if (ctx.signal?.aborted) return this.aborted(symbolId);

      const snippet = result.data.content;
      const truncated = result.data.truncated || rangeCapped;
      const displayName = target.qualifiedName || target.name;
      const languageId = getLanguageId(target.filePath);
      const fence = `\`\`\`${languageId}\n${snippet}\n\`\`\``;

      return {
        id: this.id,
        name: `symbol:${symbolId}`,
        range: null,
        value: {
          id: target.id,
          name: target.name,
          kind: target.kind,
          filePath: target.filePath,
          lineRange: { start: startLine, end: endLine },
          truncated,
        },
        modelDescription:
          `Symbol ${displayName} (${target.kind}) in ${target.filePath}:${startLine}-${endLine}:\n` +
          `${fence}${truncated ? '\n[truncated]' : ''}`,
        tool: this.tool,
      };
    } catch (err) {
      return {
        id: this.id,
        name: `symbol:${symbolId}`,
        range: null,
        value: null,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  private aborted(symbolId: string): ResolvedReference {
    return {
      id: this.id,
      name: `symbol:${symbolId}`,
      range: null,
      value: null,
      error: { message: 'Reference resolution aborted' },
    };
  }
}
