import { spawn } from 'node:child_process';
import type { GlobSearchInput, IGlobStorage, RawGlobResult } from '../../types/glob.js';
import { PathNotFoundError } from '../../errors/not-found.js';
import { StorageReadError } from '../../errors/storage.js';
import { InvalidInputError } from '../../errors/validation.js';
import { toIgnoreGlobs } from '../../utils/ignore-globs.js';
import { resolveRgPath } from './grep.js';

/** Hard cap on buffered stdout so an enormous match set cannot OOM the host. */
const STDOUT_BYTE_CAP = 16 * 1024 * 1024;

export class GlobStorage implements IGlobStorage {
  async search(input: GlobSearchInput): Promise<RawGlobResult> {
    return runRg(input);
  }
}

function buildArgs(input: GlobSearchInput): string[] {
  const args = ['--files', '--glob', input.pattern, '--sort', 'modified'];
  // Honor .gitignore/.ignore even when the workspace is not a git repo.
  if (input.respectIgnoreFiles) {
    args.push('--no-require-git');
  } else {
    args.push('--no-ignore', '--hidden');
  }
  for (const glob of input.includeGlobs) {
    args.push('--glob', glob);
  }
  for (const pattern of input.ignoreGlobs) {
    for (const translated of toIgnoreGlobs(pattern)) {
      args.push('--glob', translated);
    }
  }
  args.push('--', input.path);
  return args;
}

function runRg(input: GlobSearchInput): Promise<RawGlobResult> {
  return new Promise((resolve, reject) => {
    const cap = input.maxResults;
    // Keep at most `cap + 1` newest paths (rg sorts by mtime ascending), so a
    // single overflow entry is enough to know the result was truncated.
    const buffer: string[] = [];
    let sawOverflow = false;
    let settled = false;
    let remainder = '';
    let stdoutBytes = 0;
    let stderr = '';

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(resolveRgPath(), buildArgs(input), {
        cwd: input.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(
        new StorageReadError('ripgrep failed to start', {
          cwd: input.cwd,
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL');
        reject(new StorageReadError(`ripgrep timed out after ${input.timeoutMs}ms`, { cwd: input.cwd }));
      });
    }, input.timeoutMs);
    timer.unref();

    const push = (line: string): void => {
      if (line === '') return;
      buffer.push(line);
      if (buffer.length > cap + 1) buffer.shift();
      if (buffer.length > cap) sawOverflow = true;
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_BYTE_CAP) {
        sawOverflow = true;
        child.kill('SIGKILL');
        return;
      }
      remainder += chunk.toString('utf8');
      const lines = remainder.split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) push(line);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error: Error) => {
      finish(() => {
        reject(new StorageReadError(`ripgrep failed to run: ${error.message}`, { cwd: input.cwd }));
      });
    });

    child.on('close', (code: number | null) => {
      finish(() => {
        // Killed by us after the byte cap: keep what we have.
        if (sawOverflow && stdoutBytes > STDOUT_BYTE_CAP) {
          resolve({ paths: buffer.slice(-cap), truncated: true });
          return;
        }
        // rg exit 0 = matches, 1 = no matches. Both are successful runs.
        if (code === 0 || code === 1) {
          push(remainder);
          resolve({ paths: buffer.slice(-cap), truncated: sawOverflow });
          return;
        }
        reject(classifyRgError(code, stderr, input));
      });
    });
  });
}

function classifyRgError(code: number | null, stderr: string, input: GlobSearchInput): Error {
  const clean = stderr.trim().slice(0, 500);
  if (/glob parse error|error parsing glob|unclosed|invalid glob/i.test(clean)) {
    return new InvalidInputError(`Invalid glob pattern: ${clean}`);
  }
  if (/no such file or directory/i.test(clean)) {
    return new PathNotFoundError(input.path || '.', { stderr: clean });
  }
  return new StorageReadError(
    `ripgrep exited with code ${code ?? 'signal'}: ${clean || 'unknown error'}`,
    { cwd: input.cwd },
  );
}
