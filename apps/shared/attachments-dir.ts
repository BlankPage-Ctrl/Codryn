import { join } from 'node:path';
import { resolveConfigBasePath } from '../../src/config/utils/path-resolver.js';

export function resolveAttachmentsDir(basePath?: string): string {
  const base = basePath ?? resolveConfigBasePath();
  return join(base, 'attachments');
}
