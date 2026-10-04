/**
 * Magic-byte sniffing for the image formats.
 * Keep in sync with ALLOWED_IMAGE_MEDIA_TYPES in types/attachment.ts.
 */

export type SniffedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  return head === 'GIF87a' || head === 'GIF89a';
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff =
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp =
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return riff && webp;
}

/** Returns the detected media type, or null when the bytes are not a supported image. */
export function sniffImageMediaType(bytes: Uint8Array): SniffedImageMediaType | null {
  if (startsWith(bytes, PNG_SIG)) return 'image/png';
  if (startsWith(bytes, JPEG_SIG)) return 'image/jpeg';
  if (isGif(bytes)) return 'image/gif';
  if (isWebp(bytes)) return 'image/webp';
  return null;
}
