import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'TOKEN_EXPIRED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PATH_NOT_FOUND',
  'PATH_TRAVERSAL',
  'REQUIRES_APPROVAL',
  'NOT_A_DIRECTORY',
  'NOT_A_FILE',
  'PERMISSION_DENIED',
  'FILE_TOO_LARGE',
  'WORKSPACE_NOT_FOUND',
  'EDIT_FAILED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
