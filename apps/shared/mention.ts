import type { TextUIPart } from 'ai';
import {
  MentionService,
  type MentionParseOptions,
  type MentionRequest,
  type ResolutionContext,
} from '../../src/mentions/index.js';
import type { Container } from '../bootstrap.js';
import { buildMentionContext } from './mention-context.js';
import { buildFmServices } from './fm-services.js';
import { FileReferenceResolver } from './mentions/resolver/file.js';
import { FolderReferenceResolver } from './mentions/resolver/folder.js';
import { SymbolReferenceResolver, type SymbolTarget } from './mentions/resolver/symbol.js';
import { insightGraph } from '../insight/execute/graph.js';

export type SystemTextPart = TextUIPart & { isSystem: true };

export interface ResolveMentionResult {
  request: MentionRequest | null;
  bysystemPart: SystemTextPart | null;
}

export async function buildMentionService(
  ctx: Container,
  projectPath: string,
  opts?: { workspaceId?: string },
): Promise<MentionService> {
  const { readFileService, getStatService, listDirService } = await buildFmServices(
    ctx,
    projectPath,
  );
  const workspaceId = opts?.workspaceId;
  const lookupSymbol = async (id: string): Promise<SymbolTarget> => {
    if (!workspaceId) throw new Error('Symbol lookup needs workspace context');
    const graph = await insightGraph({ workspaceId, settings: ctx.settingsService }, { id });
    const node = graph.nodes.find((n) => n.id === id) ?? graph.nodes[0];
    if (!node) throw new Error(`Symbol not found: ${id}`);
    return {
      id: node.id,
      name: node.name,
      kind: node.kind,
      filePath: node.filePath,
      startLine: node.lineRange.start,
      endLine: node.lineRange.end,
      signature: node.signature,
    };
  };
  return new MentionService({
    resolvers: [
      new FileReferenceResolver(readFileService),
      new FolderReferenceResolver({
        getStat: (path) => getStatService.getStat(path),
        listDir: (path) => listDirService.listDir(path),
      }),
      new SymbolReferenceResolver({
        lookup: lookupSymbol,
        readFile: (path, range) => readFileService.readFile(path, range),
      }),
    ],
  });
}

/** For tests that want a service without fm - pass custom resolvers explicitly */
export function buildMentionServiceWithResolvers(
  resolvers: import('../../src/mentions/index.js').IReferenceResolver[],
): MentionService {
  return new MentionService({ resolvers });
}

export async function buildMentionArtifacts(
  service: MentionService,
  context: ResolutionContext,
  text: string,
  options: Omit<MentionParseOptions, 'context'> = {},
): Promise<ResolveMentionResult> {
  try {
    const request = await service.parse(text, { ...options, context });

    const content = request.references
      .map((ref) => ref.modelDescription)
      .filter((desc): desc is string => desc != null && desc.length > 0)
      .join('\n\n');

    if (!content) return { request, bysystemPart: null };

    return {
      request,
      bysystemPart: { type: 'text', text: content, isSystem: true },
    };
  } catch {
    return { request: null, bysystemPart: null };
  }
}

export async function resolveMention(
  ctx: Container,
  projectPath: string,
  text: string,
  options: Omit<MentionParseOptions, 'context'> = {},
  workspaceId?: string,
): Promise<ResolveMentionResult> {
  const context = buildMentionContext(projectPath, {
    signal: options.signal,
    tokenBudget: options.tokenBudget,
  });
  const service = await buildMentionService(ctx, projectPath, { workspaceId });
  const result = await buildMentionArtifacts(service, context, text, options);
  if (!result.request) {
    ctx.logger.warn({}, 'mention resolution failed; sending raw prompt');
  }
  return result;
}
