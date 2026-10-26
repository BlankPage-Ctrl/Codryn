import { z } from 'zod';
import { getProviderPlugin } from './registry.js';

/**
 * One row of a remote model catalog. Extra fields ride along untyped: the raw JSON
 * object is handed back so capability metadata sharing the row survives this layer.
 */
export type RemoteModelEntry = { id: string } & Record<string, unknown>;

/** Raised when a model-list endpoint cannot be read. Actions translate it to an AppError. */
export class ModelListError extends Error {
  constructor(
    message: string,
    public readonly reason: 'unauthorized' | 'unreachable' | 'invalid-response' | 'no-endpoint',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ModelListError';
  }
}

const TIMEOUT_MS = 10_000;

/** Minimal contract shared by OpenAI-style catalogs: `{ data: [{ id }] }`. */
const modelListIndexSchema = z.object({
  data: z.array(z.object({ id: z.string() }).passthrough()).optional(),
});

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Join an API root (e.g. https://api.openai.com/v1) with the plugin's model-list path. */
export function buildModelListURL(baseURL: string, path: string): string {
  if (!baseURL.trim()) {
    throw new ModelListError('Provider has no base URL to list models from', 'no-endpoint');
  }
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${stripTrailingSlashes(baseURL)}${suffix}`;
}

/** Whether the given provider type rejects keyless model-list requests. Read before fetching. */
export function modelListRequiresApiKey(type: string): boolean {
  return getProviderPlugin(type)?.modelList.requiresApiKey ?? false;
}

/**
 * Fetch a provider's model catalog. Throws on any failure - unlike the agent-side
 * capability index, callers show these errors to a user.
 */
export async function fetchModelList(opts: {
  url: string;
  apiKey?: string;
}): Promise<RemoteModelEntry[]> {
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  let res: Response;
  try {
    res = await fetch(opts.url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ModelListError(`Could not reach ${opts.url}`, 'unreachable', err);
  }

  if (res.status === 401 || res.status === 403) {
    throw new ModelListError(
      `Model list rejected: ${res.status} ${res.statusText}`,
      'unauthorized',
    );
  }
  if (!res.ok) {
    throw new ModelListError(`Model list failed: ${res.status} ${res.statusText}`, 'unreachable');
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new ModelListError('Model list returned a non-JSON body', 'invalid-response', err);
  }

  const parsed = modelListIndexSchema.safeParse(json);
  if (!parsed.success) {
    throw new ModelListError(
      'Model list returned an unexpected shape',
      'invalid-response',
      parsed.error,
    );
  }
  return parsed.data.data ?? [];
}
