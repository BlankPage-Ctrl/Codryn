import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger as PinoInstance } from 'pino';
import type { Container } from '../bootstrap.js';
import { registerEnvelope } from './envelope.js';
import { registerAuthMiddleware } from './middleware/auth.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { registerRoutes } from './routes/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export function createApp(
  ctx: Container,
  opts: { loggerInstance?: PinoInstance } = {},
): FastifyInstance {
  // 15 MiB: large enough for an 8 MiB image as base64 JSON (~10.7 MiB)
  // plus message envelope; file-count rules are enforced by validators.
  const bodyLimit = 15 * 1024 * 1024;
  const app = (
    opts.loggerInstance
      ? Fastify({ loggerInstance: opts.loggerInstance as never, bodyLimit })
      : Fastify({ logger: true, bodyLimit })
  ) as FastifyInstance;

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const raw = body.toString('utf8');
    req.rawBody = raw;
    if (body.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error);
    }
  });

  registerEnvelope(app);
  registerErrorHandler(app);
  registerAuthMiddleware(app, ctx);
  registerRoutes(app, ctx);

  return app;
}
