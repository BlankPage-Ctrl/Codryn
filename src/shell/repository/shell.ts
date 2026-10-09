import type { IShellExecutor, ExecOutput, ShellExecChunk } from '../types/index.js';
import { ShellRunInputSchema, type ShellRunInput } from '../types/index.js';
import { ValidationError } from '../errors/validation.js';

/**
 * Mediates process execution; Zod is the gatekeeper - command input never
 * reaches the executor unvalidated.
 */
export class ShellRepository {
  constructor(private readonly cold: IShellExecutor) {}

  async run(input: ShellRunInput, executionId?: string): Promise<ExecOutput> {
    const parsed = ShellRunInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid shell input: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues },
      );
    }
    return this.cold.run({ ...parsed.data, executionId });
  }

  async runStream(
    input: ShellRunInput,
    onChunk: (chunk: ShellExecChunk) => void,
    executionId?: string,
  ): Promise<ExecOutput> {
    const parsed = ShellRunInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid shell input: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        { issues: parsed.error.issues },
      );
    }
    return this.cold.runStream({ ...parsed.data, executionId }, onChunk);
  }

  /**
   * Best-effort kill of a live run. Never throws for unknown ids; returns
   * false when nothing was running under that execution id.
   */
  kill(executionId: string): boolean {
    return this.cold.kill(executionId);
  }
}
