/* Format `<id>__<sanitized>` */
export function sanitizeFilename(raw: string, maxLength = 100): string {
  // Split on both separators explicitly: attachment names may carry Windows
  // paths even when the server runs on Linux (browsers send `C:\fakepath\`),
  // while node:path.basename only strips the host platform's separator.
  const baseRaw = raw
    .trim()
    .split(/[/\\]+/)
    .filter((seg) => seg.length > 0)
    .pop() ?? '';
  const base = baseRaw.replace(/\0/g, '');
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
