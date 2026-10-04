import type { Container } from '../bootstrap.js';
import type { GetStatData } from '../../src/fm/index.js';
import { buildFmServices } from '../shared/fm-services.js';
import { NotFoundError } from '../shared/errors.js';

export async function getStat(
  ctx: Container,
  params: { workspaceId: string; path: string },
): Promise<GetStatData> {
  const ws = await ctx.workspacesService.findOne(params.workspaceId);
  const { getStatService } = await buildFmServices(ctx, ws.projectPath);
  const result = await getStatService.getStat(params.path);
  if (!result.success) throw new NotFoundError(result.error.message);
  return result.data;
}
