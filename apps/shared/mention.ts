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

export type SystemTextPart = TextUIPart & { isSystem: true };

export interface ResolveMentionResult {
  request: MentionRequest | null;
  bysystemPart: SystemTextPart | null;
}

export async function buildMentionService(
  ctx: Container,
  projectPath: string,
): Promise<MentionService> {
  const { readFileService, getStatService, listDirService } = await buildFmServices(
    ctx,
    projectPath,
  );
  return new MentionService({
    resolvers: [
      new FileReferenceResolver(readFileService),
      new FolderReferenceResolver({
        getStat: (path) => getStatService.getStat(path),
        listDir: (path) => listDirService.listDir(path),
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
): Promise<ResolveMentionResult> {
  const context = buildMentionContext(projectPath, {
    signal: options.signal,
    tokenBudget: options.tokenBudget,
  });
  const service = await buildMentionService(ctx, projectPath);
  const result = await buildMentionArtifacts(service, context, text, options);
  if (!result.request) {
    ctx.logger.warn({}, 'mention resolution failed; sending raw prompt');
  }
  return result;
}
