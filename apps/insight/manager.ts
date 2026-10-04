import { isInsightEnabled } from './execute/settings.js';
import { InsightDisabledError } from './execute/errors.js';
import { ensureInsightBinary } from './binary.js';
import { createInsightClient, type InsightClient } from './execute/client.js';
import type {
  InsightBinarySummary,
  InsightEnsureResult,
  InsightExecuteDeps,
  InsightLogger,
} from './types.js';

type Entry = {
  client: InsightClient;
  projectPath: string;
  createdAt: number;
};

export class InsightManager {
  private readonly entries = new Map<string, Entry>();
  private readonly starting = new Map<string, Promise<InsightClient>>();

  constructor(private readonly logger?: InsightLogger) {}

  /**
   * @internal - ONLY endpoint POST /workspaces/:id/insight/ensure may call this.
   * Tool/search/graph must NOT call ensure(); use get() + insightSearch/insightGraph.
   */
  async ensure(deps: InsightExecuteDeps): Promise<InsightEnsureResult> {
    const enabled = await isInsightEnabled(deps.settings, deps.workspaceId);
    if (!enabled) {
      await this.stop(deps.workspaceId);
      throw new InsightDisabledError(deps.workspaceId);
    }

    // Resolve + version-check first so every return path reports the binary.
    // Missing binary throws; version mismatch? warns.
    const bin = await ensureInsightBinary({
      binaryPath: deps.binaryPath,
      logger: deps.logger ?? this.logger,
    });
    const binary: InsightBinarySummary = {
      path: bin.path,
      source: bin.source,
      version: bin.version,
      compatible: bin.compatible,
      ...(bin.warning ? { warning: bin.warning } : {}),
    };

    const existing = this.entries.get(deps.workspaceId);
    if (existing && !existing.client.closed && existing.projectPath === deps.projectPath) {
      return {
        workspaceId: deps.workspaceId,
        enabled: true,
        running: true,
        projectPath: deps.projectPath,
        binary,
      };
    }
    if (existing) {
      await this.stop(deps.workspaceId);
    }

    // dedup concurrent ensure()
    const inflight = this.starting.get(deps.workspaceId);
    if (inflight) {
      await inflight;
      const e = this.entries.get(deps.workspaceId);
      return {
        workspaceId: deps.workspaceId,
        enabled: true,
        running: !!e && !e.client.closed,
        projectPath: deps.projectPath,
        binary,
      };
    }

    const p = (async () => {
      const client = await createInsightClient(deps);
      // eagerly start standby daemon via ping (cheap, non-blocking)
      try {
        await client.ping();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Fail fast on real startup faults. Only old binaries without ping
        // fall through to the search warmup below.
        if (!/method not found|unknown method/i.test(msg)) {
          await client.close().catch(() => {});
          throw err;
        }
        try {
          await client.search({ query: '__warmup__', limit: 1 });
        } catch (searchErr) {
          await client.close().catch(() => {});
          throw searchErr;
        }
      }
      this.entries.set(deps.workspaceId, {
        client,
        projectPath: deps.projectPath,
        createdAt: Date.now(),
      });
      return client;
    })();

    this.starting.set(deps.workspaceId, p);
    try {
      await p;
    } finally {
      this.starting.delete(deps.workspaceId);
    }

    return {
      workspaceId: deps.workspaceId,
      enabled: true,
      running: true,
      projectPath: deps.projectPath,
      binary,
    };
  }

  get(workspaceId: string): InsightClient | null {
    const e = this.entries.get(workspaceId);
    if (!e || e.client.closed) return null;
    return e.client;
  }

  async stop(workspaceId: string): Promise<boolean> {
    const e = this.entries.get(workspaceId);
    if (!e) return false;
    this.entries.delete(workspaceId);
    try {
      await e.client.close();
    } catch (err) {
      this.logger?.warn?.({ err, workspaceId }, 'insight manager stop failed');
    }
    return true;
  }

  async stopAll(): Promise<void> {
    const ids = [...this.entries.keys()];
    for (const id of ids) await this.stop(id);
  }

  status(workspaceId: string): { running: boolean; projectPath?: string } {
    const e = this.entries.get(workspaceId);
    if (!e || e.client.closed) return { running: false };
    return { running: true, projectPath: e.projectPath };
  }

  list(): string[] {
    return [...this.entries.keys()];
  }
}

// global singleton
let globalManager: InsightManager | null = null;

export function getInsightManager(logger?: InsightLogger): InsightManager {
  if (!globalManager) globalManager = new InsightManager(logger);
  return globalManager;
}

export function setInsightManagerForTest(m: InsightManager | null): void {
  globalManager = m;
}
