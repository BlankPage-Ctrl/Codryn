import { platform as osPlatform } from 'node:os';
import type { TerminalPolicy, Verdict } from '../types/index.js';

export function defaultTerminalPolicy(mode: Verdict = 'ask'): TerminalPolicy {
  return { mode, allow: [], ask: [], deny: [] };
}

/**
 * Platform-aware default shell.
 * - win32: `powershell.exe` (always present; `pwsh` is used only when
 *   explicitly configured since PS7 may not be installed).
 * - otherwise: `bash`.
 */
export function defaultShellForPlatform(plat: NodeJS.Platform = osPlatform()): string {
  return plat === 'win32' ? 'powershell.exe' : 'bash';
}
