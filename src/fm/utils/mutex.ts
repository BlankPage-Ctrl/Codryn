/**
 * In-process per-key async mutex.
 *
 * Serializes read-modify-write cycles (like editFile on the same path)
 * that would otherwise interleave when parallel tool calls run
 * concurrently, both read the same base, both write, last write wins
 * and the first edit is silently lost.
 *
 * Callers await the lock, this is blocking serialization, not a
 * background queue. Scope is a single process (the embedded backend).
 * Multi-process deployments need an external lock.
 */
const tails = new Map<string, Promise<void>>();

export async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let releaseLock: () => void = () => undefined;
  const lock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const tail = previous.then(
    () => lock,
    () => lock,
  );
  tails.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    releaseLock();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
