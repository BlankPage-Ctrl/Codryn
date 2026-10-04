import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    apiRequestId: string;
    apiResponseId: string;
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function genID(prefix: 'req' | 'resp'): string {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

export function registerEnvelope(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const incoming = (req.headers['x-request-id'] as string | undefined)?.trim();
    req.apiRequestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : genID('req');
    req.apiResponseId = genID('resp');

    reply.header('x-request-id', req.apiRequestId);
    reply.header('x-response-id', req.apiResponseId);
  });

  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload) => {
    if (typeof payload !== 'string' || payload.length === 0) return payload;

    let body: unknown;
    try {
      body = JSON.parse(payload);
    } catch {
      return payload;
    }

    if (body === undefined || body === null) return payload;

    const isError =
      typeof body === 'object' &&
      !Array.isArray(body) &&
      (body as { error?: unknown }).error !== undefined;

    const envelope: Record<string, unknown> = {
      requestId: req.apiRequestId,
      responseId: req.apiResponseId,
      status: reply.statusCode,
      timestamp: new Date().toISOString(),
    };

    if (isError) {
      envelope.data = null;
      envelope.error = (body as { error: unknown }).error;
    } else {
      envelope.data = body;
    }

    reply.header('content-type', 'application/json; charset=utf-8');
    return JSON.stringify(envelope);
  });
}
