import type { Container } from '../bootstrap.js';
import type { ListDirData } from '../../src/fm/index.js';
import { buildFmServices } from '../shared/fm-services.js';
import { NotFoundError } from '../shared/errors.js';

export async function listFiles(
  ctx: Container,
  params: { workspaceId: string; path: string },
): Promise<ListDirData> {
  const ws = await ctx.workspacesService.findOne(params.workspaceId);
  const { listDirService } = await buildFmServices(ctx, ws.projectPath);
  const result = await listDirService.listDir(params.path);
  if (!result.success) throw new NotFoundError(result.error.message);
  return result.data;
}
