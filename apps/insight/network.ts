import { lookup } from 'node:dns/promises';
import { InsightBinaryError } from './execute/errors.js';

/** Hosts touched by `codryn update srcinsight` (manifest, digest API, download). */
export const INSIGHT_ONLINE_HOSTS = [
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
] as const;

export interface AssertInternetOpts {
  hosts?: readonly string[];
  timeoutMs?: number;
  lookupImpl?: (host: string) => Promise<unknown>;
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('lookup timed out')), ms);
    timer.unref?.();
  });
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

export async function assertInternetAvailable(opts: AssertInternetOpts = {}): Promise<void> {
  const hosts = opts.hosts ?? INSIGHT_ONLINE_HOSTS;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const lookupImpl = opts.lookupImpl ?? ((host: string) => lookup(host));
  const results = await Promise.allSettled(
    hosts.map((host) =>
      withTimeout(
        Promise.resolve().then(() => lookupImpl(host)),
        timeoutMs,
      ),
    ),
  );
  if (results.some((r) => r.status === 'fulfilled')) return;
  throw new InsightBinaryError(
    'SrcInsight update requires an internet connection for the version check and download.',
  );
}
