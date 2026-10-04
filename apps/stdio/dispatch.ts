import { ZodError } from 'zod';
import type { Container } from '../bootstrap.js';
import type { WatchMessageRunResult } from '../actions/watch.message-run.js';
import type { WatchFileResult } from '../actions/watch.file.js';
import type { WatchHitlResult } from '../actions/watch.hitl.js';
import { AppError } from '../shared/errors.js';
import type { Logger } from '../shared/types.js';
import {
  errorResponse,
  notification,
  successResponse,
  RpcErrorCode,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol.js';
import { stdioMethods } from './registry/index.js';
import { StreamRegistry } from './streams.js';

export interface StdioDispatchContext {
  ctx: Container;
  logger: Logger;
  out: (msg: JsonRpcResponse | JsonRpcNotification) => void;
  signal?: AbortSignal;
  streams?: StreamRegistry;
}

const APP_ERROR_RPC_CODE = -32000;

export async function dispatch(deps: StdioDispatchContext, req: JsonRpcRequest): Promise<void> {
  // A `cancel` notification (no id) requests teardown of the stream owned by
  // the given requestId. Stream handlers register their per-stream
  // AbortController with deps.streams so cancellation reaches the backend.
  if (req.id === null && req.method === 'cancel') {
    const requestId = cancelRequestId(req.params);
    if (requestId !== undefined) {
      deps.streams?.abort(requestId);
    }
    return;
  }

  const method = stdioMethods[req.method];
  if (!method) {
    deps.out(
      errorResponse(req.id, RpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${req.method}`),
    );
    return;
  }

  let params: unknown;
  try {
    params = method.validate(req.params);
  } catch (err) {
    deps.out(invalidParamsResponse(req.id, err));
    return;
  }

  try {
    const result = await method.run(deps.ctx, params);
    switch (method.kind) {
      case 'plain':
        deps.out(successResponse(req.id, result));
        return;
      case 'file-stream':
        await streamFileResponse(deps, req, result as WatchFileResult);
        return;
      case 'hitl-stream':
        await streamHitlResponse(deps, req, result as WatchHitlResult);
        return;
      case 'run-stream':
        await streamRunResponse(deps, req, result as WatchMessageRunResult);
        return;
    }
  } catch (err) {
    deps.out(errorFrom(deps, req.id, err));
  }
}

function cancelRequestId(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const requestId = (params as { requestId?: unknown }).requestId;
  return typeof requestId === 'string' ? requestId : undefined;
}

function invalidParamsResponse(id: string | number | null, err: unknown): JsonRpcResponse {
  if (err instanceof ZodError) {
    return errorResponse(
      id,
      RpcErrorCode.INVALID_PARAMS,
      err.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join(', '),
      err.issues,
    );
  }
  return errorResponse(id, RpcErrorCode.INVALID_PARAMS, 'Invalid params');
}

function errorFrom(
  deps: StdioDispatchContext,
  id: string | number | null,
  err: unknown,
): JsonRpcResponse {
  if (err instanceof AppError) {
    return errorResponse(id, APP_ERROR_RPC_CODE, err.message, {
      code: err.code,
      status: err.status,
    });
  }
  deps.logger.error({ err }, 'unhandled stdio dispatch error');
  return errorResponse(id, RpcErrorCode.INTERNAL_ERROR, 'Internal error');
}

function streamRunResponse(
  deps: StdioDispatchContext,
  req: JsonRpcRequest,
  result: WatchMessageRunResult,
): Promise<void> {
  const { run, stream } = result;
  const requestKey = String(req.id);

  const cleanup = () => {
    // Unsubscribe only - the background run keeps going.
    stream.end();
  };

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      deps.out(successResponse(req.id, { runId: run.runId, status: run.status }));
      resolve();
    };

    const onData = (raw: Buffer | string) => {
      for (const line of String(raw).split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            deps.out(
              notification('message.chunk', {
                event: JSON.parse(trimmed.slice(6)),
                runId: run.runId,
                requestId: req.id,
              }),
            );
          } catch {
            deps.logger.warn({ line: trimmed }, 'malformed run event');
          }
        }
      }
    };

    stream.on('data', onData);
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', (err) => {
      deps.logger.error({ err }, 'run watch stream error');
      deps.out(errorResponse(req.id, RpcErrorCode.INTERNAL_ERROR, 'Run watch stream error'));
      finish();
    });

    const signal = deps.streams?.register(requestKey);
    signal?.addEventListener('abort', cleanup, { once: true });
    deps.signal?.addEventListener('abort', cleanup, { once: true });
  }).finally(() => {
    deps.streams?.unregister(requestKey);
  });
}

function streamFileResponse(
  deps: StdioDispatchContext,
  req: JsonRpcRequest,
  result: WatchFileResult,
): Promise<void> {
  const { service, stream } = result;
  const requestKey = String(req.id);

  const cleanup = () => {
    void service.stop().catch(() => {});
    stream.end();
  };

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      deps.out(successResponse(req.id, null));
      resolve();
    };

    const onData = (raw: Buffer | string) => {
      for (const line of String(raw).split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            deps.out(
              notification('file.event', {
                event: JSON.parse(trimmed.slice(6)),
                requestId: req.id,
              }),
            );
          } catch {
            deps.logger.warn({ line: trimmed }, 'malformed watch event');
          }
        }
      }
    };

    stream.on('data', onData);
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', (err) => {
      deps.logger.error({ err }, 'watch stream error');
      deps.out(errorResponse(req.id, RpcErrorCode.INTERNAL_ERROR, 'File watch stream error'));
      finish();
    });

    const signal = deps.streams?.register(requestKey);
    signal?.addEventListener('abort', cleanup, { once: true });
    deps.signal?.addEventListener('abort', cleanup, { once: true });
  }).finally(() => {
    deps.streams?.unregister(requestKey);
  });
}

function streamHitlResponse(
  deps: StdioDispatchContext,
  req: JsonRpcRequest,
  result: WatchHitlResult,
): Promise<void> {
  const { stream } = result;
  const requestKey = String(req.id);

  const cleanup = () => {
    stream.end();
  };

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      deps.out(successResponse(req.id, null));
      resolve();
    };

    const onData = (raw: Buffer | string) => {
      for (const line of String(raw).split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            deps.out(
              notification('hitl.event', {
                event: JSON.parse(trimmed.slice(6)),
                requestId: req.id,
              }),
            );
          } catch {
            deps.logger.warn({ line: trimmed }, 'malformed hitl watch event');
          }
        }
      }
    };

    stream.on('data', onData);
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', (err) => {
      deps.logger.error({ err }, 'hitl watch stream error');
      deps.out(errorResponse(req.id, RpcErrorCode.INTERNAL_ERROR, 'HITL watch stream error'));
      finish();
    });

    const signal = deps.streams?.register(requestKey);
    signal?.addEventListener('abort', cleanup, { once: true });
    deps.signal?.addEventListener('abort', cleanup, { once: true });
  }).finally(() => {
    deps.streams?.unregister(requestKey);
  });
}
