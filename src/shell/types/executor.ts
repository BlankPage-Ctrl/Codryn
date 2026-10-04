import type { ShellExecChunk } from './shell-events.js';

export interface ExecRunOptions {
  command: string;
  shell: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxBufferBytes: number;
}

export interface ExecOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr interleaved in arrival order. */
  interleaved: string;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
}

export interface IShellExecutor {
  run(opts: ExecRunOptions): Promise<ExecOutput>;
  runStream(opts: ExecRunOptions, onChunk: (chunk: ShellExecChunk) => void): Promise<ExecOutput>;
}
