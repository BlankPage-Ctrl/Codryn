import { execa, ExecaError } from 'execa';
import type {
  ExecOutput,
  ExecRunOptions,
  IShellExecutor,
  ShellExecChunk,
} from '../../types/index.js';
import { ExecutionError } from '../../errors/execution.js';
import { ShellDomainError } from '../../errors/base.js';
export class ShellExecutor implements IShellExecutor {
  async run(opts: ExecRunOptions): Promise<ExecOutput> {
    const start = Date.now();

    try {
      const result = await execa(opts.command, {
        shell: opts.shell,
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs,
        killSignal: 'SIGKILL',
        all: true,
        maxBuffer: opts.maxBufferBytes,
      });
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
      killSignal: 'SIGKILL',
      all: true,
      maxBuffer: opts.maxBufferBytes,
    });

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
    }
  }
}
