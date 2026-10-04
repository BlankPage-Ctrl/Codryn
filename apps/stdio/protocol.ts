export const JSONRPC_VERSION = '2.0' as const;

export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: unknown;
}

export const RpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export function encodeLine(obj: JsonRpcResponse | JsonRpcNotification): string {
  return `${JSON.stringify(obj)}\n`;
}

export function parseRequestLine(line: string): JsonRpcRequest {
  const raw: unknown = JSON.parse(line);
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('INVALID_REQUEST: payload is not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.jsonrpc !== JSONRPC_VERSION || typeof obj.method !== 'string') {
    throw new Error('INVALID_REQUEST: missing jsonrpc/method');
  }
  if (obj.id !== undefined && !isValidId(obj.id)) {
    throw new Error('INVALID_REQUEST: invalid id');
  }
  return {
    jsonrpc: JSONRPC_VERSION,
    id: obj.id === undefined ? null : (obj.id as string | number),
    method: obj.method,
    params: obj.params,
  };
}

function isValidId(id: unknown): id is string | number {
  return typeof id === 'string' || typeof id === 'number';
}

export function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, data },
  };
}

export function successResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result: result ?? null,
  };
}

export function notification(method: string, params: unknown): JsonRpcNotification {
  return { jsonrpc: JSONRPC_VERSION, method, params };
}
