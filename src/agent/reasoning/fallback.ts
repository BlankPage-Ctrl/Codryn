import type { ReasoningFallbackOptions, ThinkingLevel } from '../types/index.js';

export type { ReasoningFallbackOptions } from '../types/index.js';

export async function withReasoningFallback<
  T extends {
    fullStream: AsyncIterable<{ type?: string }>;
    stream: ReadableStream<unknown>;
  },
>(
  run: (thinkingLevel: ThinkingLevel) => T | PromiseLike<T>,
  options: ReasoningFallbackOptions = {},
): Promise<T> {
  const { capability, level = 'default' } = options;

  const outcomeKnown = !!capability && (!capability.reasoning || !capability.thinkingCanDisable);

  if (level === 'none' || outcomeKnown) {
    return run(level);
  }

  const first = await run(level);

  let iter: AsyncIterator<{ type?: string }> | undefined;
  try {
    iter = first.fullStream[Symbol.asyncIterator]();
    const { value, done } = await iter.next();

    if (!done && value?.type === 'error') {
      await iter.return?.();
      await first.stream.cancel?.().catch(() => {});
      return run('none');
    }

    if (value !== undefined) {
      async function* replay(): AsyncGenerator<{ type?: string }> {
        yield value as { type?: string };
        while (true) {
          const res = await iter!.next();
          if (res.done) break;
          yield res.value as { type?: string };
        }
      }
      Object.defineProperty(first, 'fullStream', {
        value: { [Symbol.asyncIterator]: () => replay() },
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    return first;
  } catch {
    try {
      await iter?.return?.();
    } catch {
      // Best-effort iterator cleanup, outer fallback below still runs.
    }
    try {
      await first.stream.cancel?.();
    } catch {
      // Best-effort stream cancel, outer fallback below still runs.
    }
    return run('none');
  }
}
