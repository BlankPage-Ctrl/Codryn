import crypto from 'crypto';
import { buildCanonicalString, type CanonicalStringInput } from './canonical.js';

const MAX_TIMESTAMP_AGE_SECONDS = 300;

export function createSignature(secretKey: string, canonicalString: string): string {
  return crypto.createHmac('sha256', secretKey).update(canonicalString, 'utf8').digest('hex');
}

export function createBodyHash(body: string): string {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

export function buildStringToSign(canonicalRequest: string): string {
  const hash = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  return ['HMAC-SHA256', hash].join('\n');
}

export function verifySignature(
  secretKey: string,
  canonicalString: string,
  receivedSignature: string,
): boolean {
  const expectedSignature = createSignature(secretKey, canonicalString);
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(receivedSignature, 'hex'),
  );
}

export function validateTimestamp(timestamp: string): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - ts);
  return age <= MAX_TIMESTAMP_AGE_SECONDS;
}

export function buildCanonicalAndVerify(input: {
  secretKey: string;
  method: string;
  path: string;
  queryString: string;
  body: string;
  timestamp: string;
  requestId?: string;
  signatureHeader: string;
}): { valid: boolean; reason?: string } {
  if (!validateTimestamp(input.timestamp)) {
    return { valid: false, reason: 'Timestamp expired or invalid (max 5 minutes)' };
  }

  const bodyHash = createBodyHash(input.body);
  const canonicalInput: CanonicalStringInput = {
    method: input.method,
    path: input.path,
    queryString: input.queryString,
    timestamp: input.timestamp,
    requestId: input.requestId,
    bodyHash,
  };

  const canonicalString = buildCanonicalString(canonicalInput);
  const stringToSign = buildStringToSign(canonicalString);

  const [, receivedHex] = input.signatureHeader.split('=', 2);
  if (!receivedHex) {
    return { valid: false, reason: 'Missing signature in header' };
  }

  try {
    const valid = verifySignature(input.secretKey, stringToSign, receivedHex);
    if (!valid) {
      return { valid: false, reason: 'Signature mismatch' };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid signature format' };
  }
}
