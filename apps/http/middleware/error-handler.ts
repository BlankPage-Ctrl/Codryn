import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ApiErrorCode, AppError } from '../../shared/errors.js';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message },
      });
    }

    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: ApiErrorCode.VALIDATION_FAILED,
          message: 'Invalid request',
          issues: err.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
      });
    }

    // Domain errors (src/<domain>/errors/) carry `code`, legacy errors carry `errorCode`.
    const code =
      (err as { code?: string } | undefined)?.code ??
      (err as { errorCode?: string } | undefined)?.errorCode;
    const message = err instanceof Error ? err.message : 'Request failed';

    const mapped =
      code === 'NOT_FOUND' ||
      code === 'CHAT_NOT_FOUND' ||
      code === 'PROVIDER_NOT_FOUND' ||
      code === 'CLIENT_NOT_FOUND'
        ? { status: 404, code: ApiErrorCode.NOT_FOUND }
        : code === 'MODEL_NOT_FOUND'
          ? { status: 404, code: ApiErrorCode.MODEL_NOT_FOUND }
          : code === 'VALIDATION_FAILED'
            ? { status: 400, code: ApiErrorCode.VALIDATION_FAILED }
            : code === 'CONTEXT_LENGTH_EXCEEDED'
              ? { status: 400, code: ApiErrorCode.CONTEXT_LENGTH_EXCEEDED }
              : code === 'CONTENT_FILTERED'
                ? { status: 400, code: ApiErrorCode.CONTENT_FILTERED }
                : code === 'PAYMENT_REQUIRED'
                  ? { status: 402, code: ApiErrorCode.PAYMENT_REQUIRED }
                  : code === 'RATE_LIMITED'
                    ? { status: 429, code: ApiErrorCode.RATE_LIMITED }
                    : code === 'PROVIDER_UNAVAILABLE'
                      ? { status: 502, code: ApiErrorCode.PROVIDER_UNAVAILABLE }
                      : code === 'ALREADY_EXISTS'
                        ? { status: 409, code: ApiErrorCode.ALREADY_EXISTS }
                        : code === 'CONFLICT'
                          ? { status: 409, code: ApiErrorCode.CONFLICT }
                          : code === 'FORBIDDEN'
                            ? { status: 403, code: ApiErrorCode.FORBIDDEN }
                            : code === 'UNAUTHORIZED'
                              ? { status: 401, code: ApiErrorCode.UNAUTHORIZED }
                              : undefined;

    if (mapped) {
      return reply.code(mapped.status).send({
        error: { code: mapped.code, message },
      });
    }

    if (err instanceof Error) app.log.error({ err }, 'unhandled error');
    reply.code(500).send({
      error: {
        code: ApiErrorCode.INTERNAL_ERROR,
        message: 'Internal Server Error',
      },
    });
  });
}
