import { FmDomainError } from './base.js';

export class PathTraversalError extends FmDomainError {
  constructor(requestedPath: string, details?: unknown) {
    super('PATH_TRAVERSAL', `Path traversal detected: "${requestedPath}"`, details, 403);
  }
}
