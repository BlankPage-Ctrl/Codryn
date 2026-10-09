import { PassThrough } from 'node:stream';
import type { Container } from '../bootstrap.js';
import type { ShellExecEventBus } from '../../src/shell/index.js';

export interface WatchShellExecParams {
  workspaceId: string;
}

export interface WatchShellExecResult {
  stream: PassThrough;
}

/**
 * Opens a workspace-scoped stream of shell execution events. Every event is
 * tagged with `executionId` + `toolCallId` + `workspaceId` so the UI can route
 * realtime output to the correct surface without ambiguity.
 */
export async function watchShellExec(
  ctx: Container,
  params: WatchShellExecParams,
): Promise<WatchShellExecResult> {
  const stream = new PassThrough();
  const bus = ctx.shellExecBus as ShellExecEventBus;

  const write = (obj: unknown) => stream.write(`data: ${JSON.stringify(obj)}\n\n`);

  const onStart = (payload: unknown) => write({ type: 'start', ...(payload as object) });
  const onChunk = (payload: unknown) => write({ type: 'chunk', ...(payload as object) });
  const onDone = (payload: unknown) => write({ type: 'done', ...(payload as object) });
  const onError = (payload: unknown) => write({ type: 'error', ...(payload as object) });
  const onKilled = (payload: unknown) => write({ type: 'killed', ...(payload as object) });

  const matches = (payload: unknown): boolean => {
    const ws = (payload as { workspaceId?: string | null })?.workspaceId;
    return ws === params.workspaceId;
  };

  const onStartScoped = (payload: unknown) => {
    if (matches(payload)) onStart(payload);
  };
  const onChunkScoped = (payload: unknown) => {
    if (matches(payload)) onChunk(payload);
  };
  const onDoneScoped = (payload: unknown) => {
    if (matches(payload)) onDone(payload);
  };
  const onErrorScoped = (payload: unknown) => {
    if (matches(payload)) onError(payload);
  };
  const onKilledScoped = (payload: unknown) => {
    if (matches(payload)) onKilled(payload);
  };

  bus.on('start', onStartScoped as never);
  bus.on('chunk', onChunkScoped as never);
  bus.on('done', onDoneScoped as never);
  bus.on('error', onErrorScoped as never);
  bus.on('killed', onKilledScoped as never);

  const cleanup = () => {
    bus.off('start', onStartScoped as never);
    bus.off('chunk', onChunkScoped as never);
    bus.off('done', onDoneScoped as never);
    bus.off('error', onErrorScoped as never);
    bus.off('killed', onKilledScoped as never);
  };
  stream.on('close', cleanup);
  stream.on('error', cleanup);

  return { stream };
}
