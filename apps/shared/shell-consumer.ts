import { platform as osPlatform } from 'node:os';
import type { Container } from '../bootstrap.js';
import { ShellConsumer, defaultShellForPlatform } from '../../src/shell/index.js';
import type { GlobalShellConfig } from '../../src/shell/index.js';
import { loadWorkspacePolicy } from './workspace-policy.js';

/**
 * Built-in read-only command allowlist. Consumed as the default value of
 * `[shell].readonly` in `config.toml`.
 */
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
 * Built-in default denylist. Shipped as the default value of
 * `[shell].secureDeny` in `config.toml`; `[shell].hardDeny` extends it.
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
    readonly: [...READONLY_COMMANDS],
    secureDeny: createSecureDefaults(),
    hardDeny: [],
    ...partial,
  };
}

export function buildShellConsumer(
  ctx: Container,
  workspaceRoot: string,
  workspaceId?: string,
): ShellConsumer {
  const fallback = ctx.shellService.defaultPolicy;
  return new ShellConsumer(
    ctx.shellService,
    workspaceRoot,
    (root) => loadWorkspacePolicy(root, fallback),
    workspaceId,
  );
}
