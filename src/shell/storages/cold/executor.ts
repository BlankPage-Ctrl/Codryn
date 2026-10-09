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

type LiveProcess = { kill: (signal: typeof KILL_SIGNAL) => boolean };

export class ShellExecutor implements IShellExecutor {
  private readonly live = new Map<string, LiveProcess>();

  async run(opts: ExecRunOptions): Promise<ExecOutput> {
    const start = Date.now();
    const subprocess = execa(opts.command, {
      shell: opts.shell,
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeoutMs,
      killSignal: KILL_SIGNAL,
      all: true,
      maxBuffer: opts.maxBufferBytes,
    });
    this.track(opts.executionId, subprocess);

    try {
      const result = await subprocess;
      return {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        interleaved: result.all ?? '',
        signal: result.signal ?? null,
        timedOut: false,
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
          timedOut: err.timedOut ?? false,
          durationMs: Date.now() - start,
        };
      }
      if (err instanceof ShellDomainError) throw err;
      throw new ExecutionError(err, { command: opts.command, cwd: opts.cwd, shell: opts.shell });
    } finally {
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
      timeout: opts.timeoutMs,
      killSignal: KILL_SIGNAL,
      all: true,
      maxBuffer: opts.maxBufferBytes,
    });
    this.track(opts.executionId, subprocess);

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
        timedOut: false,
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
          timedOut: err.timedOut ?? false,
          durationMs: Date.now() - start,
        };
      }
      if (err instanceof ShellDomainError) throw err;
      throw new ExecutionError(err, { command: opts.command, cwd: opts.cwd, shell: opts.shell });
    } finally {
      this.untrack(opts.executionId);
    }
  }

  kill(executionId: string): boolean {
    if (!executionId) return false;
    const proc = this.live.get(executionId);
    if (!proc) return false;
    try {
      return proc.kill(KILL_SIGNAL);
    } catch {
      return false;
    }
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
