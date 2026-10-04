import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Container } from '../../bootstrap.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';

export function registerAuthMiddleware(app: FastifyInstance, ctx: Container) {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!AUTH_ENABLED) return;

    const clientId = req.headers['x-client-id'] as string | undefined;
    const signature = req.headers['x-signature'] as string | undefined;
    const timestamp = req.headers['x-timestamp'] as string | undefined;
    const requestId = req.headers['x-request-id'] as string | undefined;

    if (!clientId || !signature || !timestamp) {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing required headers: X-Client-Id, X-Signature, X-Timestamp',
        },
      });
    }

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
    // IMPORTANT: verify the exact wire bytes the client signed. Re-stringifying
    // req.body is NOT byte-identical (Go escapes <>& as \u003c etc, key order
    // differs), which caused spurious 401s for payloads containing HTML chars.
    let bodyString = '';
    if (hasBody) {
      if (typeof req.rawBody === 'string' && req.rawBody.length > 0) {
        bodyString = req.rawBody;
      } else if (req.body) {
        bodyString = JSON.stringify(req.body);
      }
    }

    const [pathOnly, qs] = req.url.split('?');
    const result = await ctx.clientService.verifySignature({
      clientId,
      method: req.method,
      path: pathOnly,
      queryString: qs ?? '',
      body: bodyString,
      timestamp,
      requestId,
      headers: req.headers as Record<string, string>,
      signatureHeader: signature,
    });

    if (!result.valid) {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: result.reason ?? 'Unauthorized',
        },
      });
    }
  });
}
