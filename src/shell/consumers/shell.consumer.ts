import { randomUUID } from 'node:crypto';
import { resolveWithinRoot } from '../utils/path.js';
import type { ShellService } from '../services/shell.js';
import type { ShellRunMeta, ShellRunResult, TerminalPolicy } from '../types/index.js';

export interface ShellRunConsumerOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}

/**
 * App-facing adapter scoped to one workspace folder. `cwd` is relative to the
 * workspace root and may not escape it; the per-workspace policy is resolved
 * by an injected loader (wired from `apps/`, e.g. via the config module) on
 * every run.
 */
export class ShellConsumer {
  constructor(
    private readonly service: ShellService,
    public readonly workspaceRoot: string,
    private readonly policyLoader: (root: string) => TerminalPolicy | Promise<TerminalPolicy>,
    public readonly workspaceId?: string,
  ) {}

  async run(
    command: string,
    opts: ShellRunConsumerOptions = {},
    meta?: ShellRunMeta,
  ): Promise<ShellRunResult> {
    const cwd =
      opts.cwd !== undefined ? resolveWithinRoot(this.workspaceRoot, opts.cwd) : this.workspaceRoot;

    if (!cwd) {
      return {
        ok: false,
        error: {
          code: 'PATH_TRAVERSAL',
          message: `cwd "${opts.cwd}" escapes the workspace root`,
          requiresApproval: false,
          policy: { verdict: 'deny', segments: [] },
        },
        executionId: randomUUID(),
      };
    }

    const policy = await this.policyLoader(this.workspaceRoot);

    const merged: ShellRunMeta = {
      ...meta,
      workspaceId: this.workspaceId ?? meta?.workspaceId ?? null,
      chatId: meta?.chatId ?? null,
    };

    return this.service.run(
      {
        command,
        cwd,
        policy,
        timeoutMs: opts.timeoutMs,
        maxOutputChars: opts.maxOutputChars,
      },
      merged,
    );
  }
}
