import type { Container } from '../bootstrap.js';
import type { SearchFilesData, SearchFilesOptions } from '../../src/fm/index.js';
import { buildFmServices } from '../shared/fm-services.js';
import { NotFoundError } from '../shared/errors.js';

export async function searchFiles(
  ctx: Container,
  params: {
    workspaceId: string;
    path: string;
    query: string;
    options?: SearchFilesOptions;
  },
): Promise<SearchFilesData> {
  const ws = await ctx.workspacesService.findOne(params.workspaceId);
  const { searchFilesService } = await buildFmServices(ctx, ws.projectPath);
  const result = await searchFilesService.searchFiles(params.path, params.query, params.options);
  if (!result.success) throw new NotFoundError(result.error.message);
  return result.data;
}
