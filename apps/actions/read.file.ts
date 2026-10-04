import type { Container } from '../bootstrap.js';
import type { ReadFileData, ReadFileOptions } from '../../src/fm/index.js';
import { buildFmServices } from '../shared/fm-services.js';
import { NotFoundError } from '../shared/errors.js';

export async function readFile(
  ctx: Container,
  params: { workspaceId: string; path: string; options?: ReadFileOptions },
): Promise<ReadFileData> {
  const ws = await ctx.workspacesService.findOne(params.workspaceId);
  const { readFileService } = await buildFmServices(ctx, ws.projectPath);
  const result = await readFileService.readFile(params.path, params.options);
  if (!result.success) throw new NotFoundError(result.error.message);
  return result.data;
}
