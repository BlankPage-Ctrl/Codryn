import { basename } from 'node:path';

/* Format `<id>__<sanitized>` */
export function sanitizeFilename(raw: string, maxLength = 100): string {
  const base = basename(raw.trim()).replace(/\0/g, '');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_');
  let trimmed = cleaned.replace(/^[._]+/, '').replace(/[._]+$/, '');
  if (trimmed.length > maxLength) {
    // Keep the extension recognizable when truncating.
    const dot = trimmed.lastIndexOf('.');
    const ext = dot > 0 && trimmed.length - dot <= 11 ? trimmed.slice(dot) : '';
    trimmed = `${trimmed.slice(0, Math.max(1, maxLength - ext.length))}${ext}`;
  }
  return trimmed.length > 0 ? trimmed : 'image';
}

export function extensionForMediaType(mediaType: string): string {
  switch (mediaType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}
