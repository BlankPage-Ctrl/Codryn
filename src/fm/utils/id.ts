import { createHash } from 'node:crypto';

export function generateNodeId(absolutePath: string): string {
  return createHash('sha1').update(absolutePath).digest('hex').slice(0, 12);
}
