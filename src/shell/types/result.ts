import { z } from 'zod';
import type { ShellErrorCode } from './error-codes.js';
import type { SegmentInfo } from './info.js';

export interface ShellSuccess<T> {
  success: true;
  data: T;
}

export interface ShellError {
  success: false;
  error: {
    code: ShellErrorCode;
    message: string;
    requiresApproval?: boolean;
    policy?: {
      verdict: string;
      reason?: string;
      segments: SegmentInfo[];
    };
  };
}

export type ShellResult<T> = ShellSuccess<T> | ShellError;

export const ShellRunDataSchema = z.object({
  command: z.string(),
  cwd: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  interleaved: z.string(),
  stdoutAnsi: z.string(),
  stderrAnsi: z.string(),
  interleavedAnsi: z.string(),
  truncated: z.boolean(),
  spillPath: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  signal: z.string().nullable(),
  policy: z.object({
    verdict: z.string(),
    reason: z.string().optional(),
    segments: z.array(z.object({ cmd: z.string(), args: z.array(z.string()) })),
  }),
});

export type ShellRunData = z.infer<typeof ShellRunDataSchema>;

export interface ShellRunInput {
  command: string;
  shell: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxBufferBytes: number;
}

export const ShellRunInputSchema: z.ZodType<ShellRunInput> = z.object({
  command: z.string().min(1).max(16_000),
  shell: z.string().min(1),
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive(),
  maxBufferBytes: z.number().int().positive(),
});
