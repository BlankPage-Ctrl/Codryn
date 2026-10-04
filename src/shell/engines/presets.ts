import { platform as osPlatform } from 'node:os';
import type { GlobalShellConfig, TerminalPolicy } from '../types/index.js';

export const READONLY_COMMANDS = new Set([
  // POSIX read-only.
  'ls',
  'cat',
  'echo',
  'pwd',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'which',
  'diff',
  'stat',
  'du',
  'cd',
  'printf',
  'true',
  'false',
  'date',
  'uname',
  'basename',
  'dirname',
  'test',
  'env',
  'time',
  'nohup',
  'nice',
  // Windows / PowerShell read-only (lowercase; the PowerShell parser
  // normalizes cmdlets + aliases to lowercase before policy checks).
  'dir',
  'type',
  'ver',
  'where',
  'whoami',
  'hostname',
  'get-childitem',
  'get-content',
  'write-output',
  'get-location',
  'set-location',
  'get-command',
  'get-date',
  'get-item',
  'test-path',
  'clear-host',
  // Alias leftovers (kept so raw segments still match even without
  // going through the PowerShell alias normalizer).
  'gci',
  'gc',
  'gl',
  'sl',
  'cls',
]);

/**
 * Built-in non-negotiable denylist. These must never be executed, no matter
 * what the per-workspace policy or the model requests. `config.toml`
 * `[shell].hardDeny` extends this list.
 */
export function createSecureDefaults(): string[] {
  return [
    // Inline code evaluators - arbitrary execution that bypasses checks.
    'sh -c:*',
    'bash -c:*',
    'ash -c:*',
    'dash -c:*',
    'zsh -c:*',
    'ksh -c:*',
    'python -c:*',
    'python2 -c:*',
    'python3 -c:*',
    'node -e:*',
    'node -p:*',
    'ruby -e:*',
    'perl -e:*',
    'php -r:*',
    'pwsh -c:*',
    'powershell -c:*',
    // PowerShell arbitrary-execution / remoting (bypass policy the same way
    // `sh -c` does on POSIX).
    'invoke-expression:*',
    'iex:*',
    'invoke-command:*',
    // Privilege escalation.
    'sudo:*',
    'su:*',
    'doas:*',
    'pkexec:*',
    'chown:*',
    'chmod 777*',
    'chmod -R 777*',
    'takeown:*',
    'icacls:*',
    // Destructive / system-level operations.
    'rm -rf /',
    'rm -rf /*',
    'remove-item:*',
    'del:*',
    'erase:*',
    'rmdir:*',
    'rd:*',
    'format:*',
    'reg:*',
    'mkfs*',
    'dd of=/dev/*',
    'shutdown:*',
    'reboot:*',
    'halt:*',
    'poweroff:*',
    'restart-computer:*',
    'stop-computer:*',
    'set-executionpolicy:*',
    'kill -9:*',
    'pkill -9:*',
    'killall -9:*',
    'stop-process:*',
    // Command wrappers that spawn whatever they are told to.
    'xargs:*',
    'find -exec*',
    'find -execdir*',
    'start-process:*',
    // Git history rewrite.
    'git push --force:*',
    'git push -f:*',
    'git reset --hard:*',
    'git clean -fdx:*',
    // Publishing to registries.
    'npm publish:*',
    'pnpm publish:*',
    'yarn publish:*',
    'bun publish:*',
  ];
}

export function defaultTerminalPolicy(): TerminalPolicy {
  return { mode: 'ask', allow: [], ask: [], deny: [] };
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

export function defaultGlobalShellConfig(
  partial?: Partial<GlobalShellConfig>,
  plat: NodeJS.Platform = osPlatform(),
): GlobalShellConfig {
  return {
    enabled: true,
    shell: defaultShellForPlatform(plat),
    defaultTimeoutMs: 30_000,
    maxOutputChars: 25_000,
    defaultMode: 'ask',
    hardDeny: [],
    ...partial,
  };
}
