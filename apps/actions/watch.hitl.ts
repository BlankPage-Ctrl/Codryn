import { PassThrough } from 'node:stream';
import type { Container } from '../bootstrap.js';
import type { HitlEventBus } from '../../src/human-in-the-loop/index.js';

export interface WatchHitlResult {
  stream: PassThrough;
}

export async function watchHitl(ctx: Container): Promise<WatchHitlResult> {
  const stream = new PassThrough();
  const bus = ctx.hitlService.events as HitlEventBus;

  const onRequest = (request: unknown) =>
    stream.write(`data: ${JSON.stringify({ type: 'request', request })}\n\n`);
  const onResolved = (payload: unknown) =>
    stream.write(`data: ${JSON.stringify({ type: 'resolved', ...(payload as object) })}\n\n`);
  const onCancelled = (request: unknown) =>
    stream.write(`data: ${JSON.stringify({ type: 'cancelled', request })}\n\n`);
  const onExpired = (request: unknown) =>
    stream.write(`data: ${JSON.stringify({ type: 'expired', request })}\n\n`);

  bus.on('request', onRequest as never);
  bus.on('resolved', onResolved as never);
  bus.on('cancelled', onCancelled as never);
  bus.on('expired', onExpired as never);

  const cleanup = () => {
    bus.off('request', onRequest as never);
    bus.off('resolved', onResolved as never);
    bus.off('cancelled', onCancelled as never);
    bus.off('expired', onExpired as never);
  };
  stream.on('close', cleanup);
  stream.on('error', cleanup);

  return { stream };
}
