import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

/** sha256 hex of raw file bytes. */
export function hashBytes(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** gzip bytes -> base64 string for DB storage. */
export function compressToBlob(data: Buffer | string): string {
  return gzipSync(data).toString('base64');
}

/** base64 string -> original bytes. Throws on corrupt input. */
export function decompressBlob(blob: string): Buffer {
  return gunzipSync(Buffer.from(blob, 'base64'));
}
