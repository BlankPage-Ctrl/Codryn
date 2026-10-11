import { spawnSync } from 'node:child_process';
import { execa, ExecaError } from 'execa';
import type {
  ExecOutput,
  ExecRunOptions,
  IShellExecutor,
  ShellExecChunk,
} from '../../types/index.js';
import { ExecutionError } from '../../errors/execution.js';
import { ShellDomainError } from '../../errors/base.js';

/** Signal used for every kill. SIGKILL is not catchable, so no escalation. */
const KILL_SIGNAL = 'SIGKILL' as const;

type LiveProcess = {
  kill: (signal: typeof KILL_SIGNAL) => boolean;
  pid?: number;
};

/**
 * `detached: true` makes the spawned shell the leader of a fresh process
 * group, so killing the group kills the shell and every descendant
 * (npm, node, test runners) instead of orphaning them. On Windows a detached
 * child gets its own console and piped stdio never arrives, so detaching is
 * POSIX-only there; the tree is killed via `taskkill /T` instead.
 */
function spawnDetached(): boolean {
  return process.platform !== 'win32';
}

/**
 * Best-effort kill of a whole process tree rooted at `pid`. Returns true
 * when a kill signal was delivered. Never throws.
 */
function killProcessTree(pid: number | undefined, fallbackKill: () => boolean): boolean {
  if (pid == null || !Number.isFinite(pid) || pid <= 0) {
    try {
      return fallbackKill();
    } catch {
      return false;
    }
  }
  if (process.platform === 'win32') {
    try {
      const res = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      if (res.status === 0) return true;
    } catch {
      // fall through to the single-process fallback below
    }
    try {
      return fallbackKill();
    } catch {
      return false;
    }
  }
  try {
    process.kill(-pid, KILL_SIGNAL);
    return true;
  } catch {
    try {
      return fallbackKill();
    } catch {
      return false;
    }
  }
}

export class ShellExecutor implements IShellExecutor {
  private readonly live = new Map<string, LiveProcess>();

  async run(opts: ExecRunOptions): Promise<ExecOutput> {
    const start = Date.now();
    const subprocess = execa(opts.command, {
      shell: opts.shell,
      cwd: opts.cwd,
      env: opts.env,
      killSignal: KILL_SIGNAL,
      all: true,
      maxBuffer: opts.maxBufferBytes,
      detached: spawnDetached(),
    });
    this.track(opts.executionId, subprocess);
    // Manual timeout (instead of execa's) so expiry kills the whole process
    // tree, not just the wrapper shell. Same reason user kills do.
    const timeout = this.armTimeout(opts);

    try {
      const result = await subprocess;
      return {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        interleaved: result.all ?? '',
        signal: result.signal ?? null,
        timedOut: timeout.timedOut(),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      if (err instanceof ExecaError) {
        return {
          exitCode: err.exitCode ?? -1,
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? '',
          interleaved: err.all ?? '',
          signal: err.signal ?? null,
          timedOut: err.timedOut || timeout.timedOut(),
          durationMs: Date.now() - start,
        };
      }
      if (err instanceof ShellDomainError) throw err;
      throw new ExecutionError(err, { command: opts.command, cwd: opts.cwd, shell: opts.shell });
    } finally {
      timeout.disarm();
      this.untrack(opts.executionId);
    }
  }

  async runStream(
    opts: ExecRunOptions,
    onChunk: (chunk: ShellExecChunk) => void,
  ): Promise<ExecOutput> {
    const start = Date.now();

    const subprocess = execa(opts.command, {
      shell: opts.shell,
      cwd: opts.cwd,
      env: opts.env,
      killSignal: KILL_SIGNAL,
      all: true,
      maxBuffer: opts.maxBufferBytes,
      detached: spawnDetached(),
    });
    this.track(opts.executionId, subprocess);
    const timeout = this.armTimeout(opts);

    subprocess.stdout?.on('data', (data: Buffer) =>
      onChunk({ stream: 'stdout', text: data.toString(), at: Date.now() }),
    );
    subprocess.stderr?.on('data', (data: Buffer) =>
      onChunk({ stream: 'stderr', text: data.toString(), at: Date.now() }),
    );

    try {
      const result = await subprocess;
      return {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        interleaved: result.all ?? '',
        signal: result.signal ?? null,
        timedOut: timeout.timedOut(),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      if (err instanceof ExecaError) {
        return {
          exitCode: err.exitCode ?? -1,
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? '',
          interleaved: err.all ?? '',
          signal: err.signal ?? null,
          timedOut: err.timedOut || timeout.timedOut(),
          durationMs: Date.now() - start,
        };
      }
      if (err instanceof ShellDomainError) throw err;
      throw new ExecutionError(err, { command: opts.command, cwd: opts.cwd, shell: opts.shell });
    } finally {
      timeout.disarm();
      this.untrack(opts.executionId);
    }
  }

  kill(executionId: string): boolean {
    if (!executionId) return false;
    return this.killLive(executionId);
  }

  /**
   * Tree-kill of one tracked run: the whole process group on POSIX, the
   * `taskkill /T` tree on Windows. Returns true when a kill was delivered.
   */
  private killLive(executionId: string | undefined): boolean {
    if (!executionId) return false;
    const proc = this.live.get(executionId);
    if (!proc) return false;
    return killProcessTree(proc.pid, () => proc.kill(KILL_SIGNAL));
  }

  /**
   * Arms a timer that tree-kills the run on expiry. The timer is disarmed by
   * the caller in `finally`; firing after settle is a harmless no-op.
   */
  private armTimeout(opts: ExecRunOptions): { disarm: () => void; timedOut: () => boolean } {
    let fired = false;
    const ms = opts.timeoutMs;
    if (!Number.isFinite(ms) || ms <= 0) {
      return { disarm: () => {}, timedOut: () => false };
    }
    const timer = setTimeout(() => {
      fired = true;
      this.killLive(opts.executionId);
    }, ms);
    return {
      disarm: () => clearTimeout(timer),
      timedOut: () => fired,
    };
  }

  private track(executionId: string | undefined, proc: LiveProcess): void {
    if (!executionId) return;
    this.live.set(executionId, proc);
  }

  private untrack(executionId: string | undefined): void {
    if (!executionId) return;
    this.live.delete(executionId);
  }
}
