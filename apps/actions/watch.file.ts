import { PassThrough } from 'node:stream';
import type { Container } from '../bootstrap.js';
import { FileWatcherService, NodeFileWatcher, type WatchEvent } from '../../src/fm/index.js';
import { buildFmServices } from '../shared/fm-services.js';

export interface WatchFileResult {
  service: FileWatcherService;
  stream: PassThrough;
}

export async function watchFile(
  ctx: Container,
  params: { workspaceId: string },
): Promise<WatchFileResult> {
  const ws = await ctx.workspacesService.findOne(params.workspaceId);

  const { ignorePatterns } = await buildFmServices(ctx, ws.projectPath);

  const watcher = new NodeFileWatcher(ctx.fileSystem, ws.projectPath, { ignorePatterns });
  const service = new FileWatcherService(watcher);
  const stream = new PassThrough();
  service.setOnEvent((event: WatchEvent) => {
    stream.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  await service.start();

  return { service, stream };
}
