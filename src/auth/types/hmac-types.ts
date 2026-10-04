export interface VerifySignatureInput {
  clientId: string;
  method: string;
  path: string;
  queryString: string;
  body: string;
  timestamp: string;
  requestId?: string;
  headers: Record<string, string>;
  signatureHeader: string;
}

export type VerifyFailureCode =
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_INACTIVE'
  | 'TIMESTAMP_EXPIRED'
  | 'SIGNATURE_MISMATCH'
  | 'MISSING_SIGNATURE';

export interface VerifySignatureResult {
  valid: boolean;
  clientId: string;
  reason?: string;
  code?: VerifyFailureCode;
}

export interface HmacSignInput {
  secretKey: string;
  method: string;
  path: string;
  queryString: string;
  body: string;
  timestamp: string;
  requestId?: string;
}
