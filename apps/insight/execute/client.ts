import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { isInsightEnabled } from './settings.js';
import {
  InsightBinaryError,
  InsightBusyError,
  InsightDisabledError,
  InsightEntryNotFoundError,
  InsightTerminalError,
} from './errors.js';
import type {
  InsightExecuteDeps,
  InsightGraph,
  InsightGraphOptions,
  InsightIndexOptions,
  InsightSearchOptions,
  InsightSearchResult,
  InsightStatusResult,
  InsightSyncResult,
  InsightTraceOptions,
  InsightTraceReport,
} from '../types.js';
import { resolveInsightPaths } from '../config.js';
import { ensureInsightBinary } from '../binary.js';
import {
  normalizeInsightImport,
  normalizeInsightNode,
  normalizeInsightSearchHit,
  normalizeInsightStats,
} from './normalize.js';

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

export interface InsightClient {
  search(opts: InsightSearchOptions): Promise<InsightSearchResult>;
  graph(opts: InsightGraphOptions): Promise<InsightGraph>;
  trace(opts: InsightTraceOptions): Promise<InsightTraceReport>;
  sync(): Promise<InsightSyncResult>;
  index(opts?: InsightIndexOptions): Promise<InsightSyncResult>;
  status(): Promise<InsightStatusResult>;
  ping(): Promise<{ ok: true }>;
  close(): Promise<void>;
  readonly closed: boolean;
  readonly terminalError: Error | null;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

const VALID_SEARCH_MODES = new Set(['auto', 'exact', 'prefix', 'substring', 'fts', '']);
const VALID_EDGE_KINDS = new Set(['calls', 'extends', 'implements', 'param', 'return', 'uses']);

function normalizeSearch(opts: InsightSearchOptions): Record<string, unknown> {
  const mode = opts.mode ?? 'auto';
  if (!VALID_SEARCH_MODES.has(mode)) {
    throw new InsightBinaryError(`insight search: invalid mode "${mode}"`);
  }
  const rawLimit = opts.limit;
  let limit: number | undefined = rawLimit;
  if (limit !== undefined) {
    limit = Math.round(limit);
    if (limit <= 0) limit = 20;
    if (limit > 200) limit = 200;
  }
  return {
    query: opts.query,
    ...(mode ? { mode } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(opts.file ? { file: opts.file } : {}),
    ...(opts.container ? { container: opts.container } : {}),
  };
}

function normalizeGraph(opts: InsightGraphOptions): Record<string, unknown> {
  if (!opts.id || typeof opts.id !== 'string' || opts.id.trim() === '') {
    throw new InsightBinaryError('insight graph: id is required');
  }
  const kinds = opts.kinds
    ? [...new Set(opts.kinds)].filter((k) => VALID_EDGE_KINDS.has(k))
    : undefined;
  return {
    id: opts.id,
    ...(kinds && kinds.length > 0 ? { kinds } : {}),
  };
}

export const INSIGHT_TRACE_MAX_DEPTH = 25;
export const INSIGHT_TRACE_MAX_TRAILS = 4;

function normalizeTrace(opts: InsightTraceOptions): Record<string, unknown> {
  const from = opts.from?.trim() ? opts.from.trim() : undefined;
  const to = opts.to?.trim() ? opts.to.trim() : undefined;
  if ((from === undefined) !== (to === undefined)) {
    throw new InsightBinaryError('insight trace: from and to must be set together');
  }
  if (opts.kinds) {
    const unknown = [...new Set(opts.kinds)].filter((k) => !VALID_EDGE_KINDS.has(k));
    if (unknown.length > 0) {
      throw new InsightBinaryError(`insight trace: unknown edge kind "${unknown[0]}"`);
    }
  }
  const kinds = opts.kinds && opts.kinds.length > 0 ? [...new Set(opts.kinds)] : undefined;
  let maxDepth: number | undefined;
  if (opts.maxDepth !== undefined) {
    maxDepth = Math.round(opts.maxDepth);
    if (!Number.isFinite(maxDepth))
      throw new InsightBinaryError('insight trace: maxDepth must be a number');
    maxDepth = Math.min(Math.max(1, maxDepth), INSIGHT_TRACE_MAX_DEPTH);
  }
  let maxTrails: number | undefined;
  if (opts.maxTrails !== undefined) {
    maxTrails = Math.round(opts.maxTrails);
    if (!Number.isFinite(maxTrails))
      throw new InsightBinaryError('insight trace: maxTrails must be a number');
    maxTrails = Math.min(Math.max(1, maxTrails), INSIGHT_TRACE_MAX_TRAILS);
  }
  return {
    ...(opts.query !== undefined ? { query: opts.query } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(maxTrails !== undefined ? { maxTrails } : {}),
    ...(kinds ? { kinds } : {}),
  };
}

/**
 * @internal - only InsightManager.ensure() may call this.
 */
export async function createInsightClient(deps: InsightExecuteDeps): Promise<InsightClient> {
  const enabled = await isInsightEnabled(deps.settings, deps.workspaceId);
  if (!enabled) throw new InsightDisabledError(deps.workspaceId);

  let mgr: { status: (id: string) => { running: boolean } } | null = null;
  try {
    const mod = await import('../manager.js');
    mgr = mod.getInsightManager();
  } catch {
    // manager not yet loaded - allow, manager.ensure is first caller
  }
  if (mgr) {
    const st = mgr.status(deps.workspaceId);
    if (st.running) {
      throw new InsightBinaryError(
        `insight already running for workspace ${deps.workspaceId} - use manager.get() instead of createInsightClient()`,
      );
    }
  }

  const { dir, db } = resolveInsightPaths(deps.projectPath, deps.dbFolder);
  // Throws a detailed not-found error when no binary exists; version
  // mismatch only warns (warn-only policy) and still runs.
  const ensured = await ensureInsightBinary({ binaryPath: deps.binaryPath, logger: deps.logger });
  const binary = ensured.path;

  let proc: ChildProcess | null = null;
  let rl: Interface | null = null;
  let closed = false;
  let idCounter = 1;
  const pendings = new Map<number, Pending>();
  let startError: unknown = null;
  let terminalError: Error | null = null;

  function failAllPendings(err: Error): void {
    for (const [, p] of pendings) p.reject(err);
    pendings.clear();
  }

  const ensureStarted = async (): Promise<void> => {
    if (proc) return;
    if (closed) throw new InsightBinaryError('client already closed');
    if (terminalError) throw terminalError;
    proc = spawn(binary, ['serve', '--root', deps.projectPath, '--db', db], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.on('error', (err) => {
      startError = err;
      const e = new InsightBinaryError(`insight spawn failed: ${String(err)}`, err);
      if (!terminalError) terminalError = e;
      failAllPendings(e);
    });
    proc.on('exit', (code, signal) => {
      if (closed) return;
      // Mark the session dead so manager.get() stops returning this client
      // and the next call fails fast instead of writing to a dead stdin.
      if (terminalError) return;
      const msg = `insight process exited code=${code} signal=${signal}`;
      const err = new InsightBinaryError(msg);
      terminalError = err;
      failAllPendings(err);
      deps.logger?.warn?.(
        { code, signal, workspaceId: deps.workspaceId },
        'insight process exited',
      );
    });
    if (proc.stdin) {
      proc.stdin.on('error', (err) => {
        if (closed || terminalError) return;
        const e = new InsightBinaryError(`insight stdin error: ${String(err)}`, err);
        terminalError = e;
        failAllPendings(e);
      });
    }
    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer) => {
        deps.logger?.warn?.({ chunk: chunk.toString('utf8').slice(0, 500) }, 'insight stderr');
      });
    }
    if (!proc.stdout) throw new InsightBinaryError('insight stdout missing');
    rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      if (!line || line.trim() === '') return;
      let parsed: JsonRpcResponse;
      try {
        parsed = JSON.parse(line) as JsonRpcResponse;
      } catch {
        deps.logger?.warn?.({ line: line.slice(0, 500) }, 'insight invalid json line');
        return;
      }

      // Terminal error frame: id null, code -32000 - session is over.
      if (parsed.id === null && parsed.error && parsed.error.code === -32000) {
        const msg = parsed.error.message ?? 'insight terminal error';
        const err = new InsightTerminalError(msg, -32000);
        terminalError = err;
        failAllPendings(err);
        deps.logger?.error?.({ msg, workspaceId: deps.workspaceId }, 'insight terminal frame');
        // also treat session as over - mark closed so next call fails fast
        return;
      }

      // Lines without id are notifications per the new protocol:
      // ignored, no side effects, no response.
      if (parsed.id === undefined || parsed.id === null) return;

      // Response
      const p = pendings.get(parsed.id);
      if (!p) {
        // could be late response after timeout
        deps.logger?.warn?.({ id: parsed.id }, 'insight response for unknown id');
        return;
      }
      pendings.delete(parsed.id);
      if (parsed.error) {
        const msg: string = parsed.error.message ?? 'insight error';
        if (parsed.error.code === -32001) {
          p.reject(new InsightBusyError(msg));
          return;
        }
        if (msg.includes('entry ID not found')) {
          p.reject(new InsightEntryNotFoundError(msg));
        } else {
          const err = new InsightBinaryError(msg, parsed.error);
          (err as unknown as Record<string, unknown>).code2 = parsed.error.code;
          p.reject(err);
        }
        return;
      }
      p.resolve(parsed.result);
    });

    // give process a tick to fail fast if binary missing
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 50);
      proc!.once('error', (err) => {
        clearTimeout(t);
        reject(err);
      });
    });
    if (startError) throw startError;
    if (terminalError) throw terminalError;
    deps.logger?.debug?.(
      { binary, dir, db, workspaceId: deps.workspaceId },
      'insight client started',
    );
  };

  async function call(method: string, params: unknown): Promise<unknown> {
    const enabledNow = await isInsightEnabled(deps.settings, deps.workspaceId);
    if (!enabledNow) throw new InsightDisabledError(deps.workspaceId);
    if (terminalError) throw terminalError;
    await ensureStarted();
    if (terminalError) throw terminalError;
    if (!proc || !proc.stdin || !rl) throw new InsightBinaryError('insight not started');
    if (closed) throw new InsightBinaryError('client already closed');
    // The process may have died between ensureStarted() and now; fail fast
    // instead of writing to a destroyed stream.
    if (proc.exitCode !== null || proc.killed || proc.stdin.destroyed) {
      const msg =
        `insight process not running (exitCode=${String(proc.exitCode)} killed=${String(proc.killed)})` +
        ' - retry ensure';
      const err = new InsightBinaryError(msg);
      if (!terminalError) {
        terminalError = err;
        failAllPendings(err);
      }
      throw err;
    }
    const id = idCounter++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return await new Promise<unknown>((resolve, reject) => {
      pendings.set(id, { resolve, reject });
      proc!.stdin!.write(payload, (err) => {
        if (err) {
          pendings.delete(id);
          reject(new InsightBinaryError(`insight write failed: ${String(err)}`, err));
        }
      });
      setTimeout(() => {
        if (pendings.has(id)) {
          pendings.delete(id);
          reject(new InsightBinaryError(`insight timeout method=${method} id=${id}`));
        }
      }, 30_000).unref?.();
    });
  }

  return {
    get closed() {
      return closed || !!terminalError;
    },
    get terminalError() {
      return terminalError;
    },
    async search(opts: InsightSearchOptions): Promise<InsightSearchResult> {
      const params = normalizeSearch(opts);
      const res = (await call('search', params)) as InsightSearchResult;
      if (res && typeof res === 'object') {
        // Older binaries return identity-only hits; fill scored-hit defaults.
        res.hits = (res.hits ?? []).map(normalizeInsightSearchHit);
        res.stats = normalizeInsightStats(res.stats);
      }
      return res;
    },
    async graph(opts: InsightGraphOptions): Promise<InsightGraph> {
      const params = normalizeGraph(opts);
      const res = (await call('graph', params)) as InsightGraph;
      if (res && typeof res === 'object') {
        res.nodes = (res.nodes ?? []).map(normalizeInsightNode);
        res.edges = res.edges ?? [];
      }
      return res;
    },
    async trace(opts: InsightTraceOptions): Promise<InsightTraceReport> {
      const params = normalizeTrace(opts);
      const res = (await call('trace', params)) as InsightTraceReport;
      // Server returns null (not []) for empty report on blank ask - coerce to documented shape.
      if (res && typeof res === 'object') {
        res.tokens = (res.tokens as unknown as null) ?? [];
        for (const [tok, hits] of Object.entries(res.anchors ?? {})) {
          res.anchors[tok] = (hits ?? []).map(normalizeInsightSearchHit);
        }
        res.anchors = res.anchors ?? {};
        res.trails = (res.trails as unknown as null) ?? [];
        res.nodes = ((res.nodes as unknown as null) ?? []).map(normalizeInsightNode);
        res.edges = (res.edges as unknown as null) ?? [];
        if (res.imports) {
          for (const [file, stmts] of Object.entries(res.imports)) {
            res.imports[file] = (stmts ?? []).map(normalizeInsightImport);
          }
        }
        res.stats = normalizeInsightStats(res.stats);
      }
      return res;
    },
    async sync(): Promise<InsightSyncResult> {
      const res = (await call('sync', {})) as InsightSyncResult;
      return res;
    },
    async index(opts?: InsightIndexOptions): Promise<InsightSyncResult> {
      const params = { force: !!opts?.force };
      const res = (await call('index', params)) as InsightSyncResult;
      return res;
    },
    async status(): Promise<InsightStatusResult> {
      const res = (await call('status', {})) as InsightStatusResult;
      return res;
    },
    async ping(): Promise<{ ok: true }> {
      const res = (await call('ping', {})) as { ok: true };
      return res;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try {
        if (proc && proc.stdin && !proc.stdin.destroyed) {
          const id = idCounter++;
          const payload = JSON.stringify({ jsonrpc: '2.0', id, method: 'shutdown' }) + '\n';
          proc.stdin.write(payload);
        }
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      try {
        rl?.close();
      } catch {
        // ignore
      }
      try {
        proc?.kill('SIGTERM');
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      try {
        if (proc && !proc.killed) proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      pendings.clear();
    },
  };
}

/** @deprecated Use manager.ensure()/manager.get() */
export async function withInsightClient<T>(): Promise<T> {
  throw new InsightBinaryError(
    'withInsightClient is disabled in Opsi A - use getInsightManager().ensure() via endpoint warmup and manager.get() for queries',
  );
}
