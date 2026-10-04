export interface ListenHostPolicy {
  /** Host that must actually be passed to listen(). */
  host: string;
  /** True when the requested host was overridden for local-only safety. */
  restricted: boolean;
  /** Host requested by config/CLI before the policy was applied. */
  requestedHost: string;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

/**
 * Default Client Key active means a well-known shared secret authenticates
 * requests, so the server must never be reachable beyond this machine
 * (no LAN/WiFi exposure). Non-loopback hosts are forced to 127.0.0.1.
 */
export function resolveListenHost(host: string, defaultKeyActive: boolean): ListenHostPolicy {
  if (!defaultKeyActive || isLoopbackHost(host)) {
    return { host, restricted: false, requestedHost: host };
  }
  return { host: '127.0.0.1', restricted: true, requestedHost: host };
}
