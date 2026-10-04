import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSecureDefaults,
  defaultGlobalShellConfig,
  defaultShellForPlatform,
  defaultTerminalPolicy,
  evaluatePolicy,
  isPowerShellShell,
  normalizePowerShellCmd,
  parsePowerShell,
  parseShell,
} from '../../src/shell/index.js';

test('powershell: detected shell names', () => {
  assert.equal(isPowerShellShell('powershell.exe'), true);
  assert.equal(isPowerShellShell('pwsh'), true);
  assert.equal(isPowerShellShell('pwsh.exe'), true);
  assert.equal(isPowerShellShell('cmd'), true);
  assert.equal(isPowerShellShell('bash'), false);
  assert.equal(isPowerShellShell(undefined), false);
});

test('powershell: default shell is powershell.exe on win32, bash elsewhere', () => {
  assert.equal(defaultShellForPlatform('win32'), 'powershell.exe');
  assert.equal(defaultShellForPlatform('linux'), 'bash');
  assert.equal(defaultShellForPlatform('darwin'), 'bash');
  assert.equal(defaultGlobalShellConfig({}, 'win32').shell, 'powershell.exe');
  assert.equal(defaultGlobalShellConfig({}, 'linux').shell, 'bash');
  // Explicit override always wins.
  assert.equal(defaultGlobalShellConfig({ shell: 'pwsh' }, 'win32').shell, 'pwsh');
});

test('powershell: splits ; chains into independent segments', () => {
  const r = parseShell('Get-ChildItem; Remove-Item foo.txt', { shell: 'powershell.exe' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(
    r.segments.map((s) => s.cmd),
    ['get-childitem', 'remove-item'],
  );
});

test('powershell: cmd is lowercased but kept as typed (no alias rewrite)', () => {
  const r = parseShell('DIR -Force', { shell: 'pwsh' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.cmd, 'dir');
  assert.equal(normalizePowerShellCmd('Get-ChildItem'), 'get-childitem');
});

test('powershell: $ expansion outside single quotes is dynamic', () => {
  assert.equal(
    parseShell('Write-Output $env:PATH', { shell: 'powershell.exe' }).segments[0]?.hasCommandSubst,
    true,
  );
  assert.equal(
    parseShell('Write-Output $(Get-Date)', { shell: 'powershell.exe' }).segments[0]
      ?.hasCommandSubst,
    true,
  );
  const inert = parseShell("Write-Output '$env:PATH'", { shell: 'powershell.exe' });
  assert.equal(inert.ok, true);
  if (!inert.ok) return;
  assert.equal(inert.segments[0]?.hasCommandSubst, false);
});

test('powershell: double-doublequote escape does not break tokenizing', () => {
  const r = parseShell('Write-Output "say ""hi"""', { shell: 'powershell.exe' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.cmd, 'write-output');
});

test('powershell: unbalanced quotes fail', () => {
  const r = parseShell('Write-Output "unclosed', { shell: 'powershell.exe' });
  assert.equal(r.ok, false);
});

test('powershell: readonly allows dir / Get-ChildItem case-insensitively', () => {
  for (const cmd of ['dir', 'DIR', 'Get-ChildItem', 'get-content', 'TYPE']) {
    const parsed = parseShell(cmd, { shell: 'powershell.exe' });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    const d = evaluatePolicy(parsed.segments, defaultTerminalPolicy(), [], {
      shell: 'powershell.exe',
    });
    assert.equal(d.verdict, 'allow', cmd);
  }
});

test('powershell: hard deny blocks iex / remove-item / start-process', () => {
  const hardDeny = createSecureDefaults();
  for (const cmd of [
    'IEX (Write-Output hi)',
    'Invoke-Expression "hi"',
    'Remove-Item -Recurse -Force C:\\tmp\\x',
    'del foo.txt',
    'Start-Process notepad.exe',
  ]) {
    const parsed = parseShell(cmd, { shell: 'powershell.exe' });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    const d = evaluatePolicy(parsed.segments, defaultTerminalPolicy(), hardDeny, {
      shell: 'powershell.exe',
    });
    assert.equal(d.verdict, 'deny', cmd);
  }
});

test('powershell: workspace allow pattern matches case-insensitively on cmd', () => {
  const parsed = parseShell('GET-CHILDITEM -Force', { shell: 'powershell.exe' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const d = evaluatePolicy(
    parsed.segments,
    { ...defaultTerminalPolicy(), mode: 'deny', allow: ['get-childitem'] },
    [],
    { shell: 'powershell.exe' },
  );
  assert.equal(d.verdict, 'allow');
});

test('powershell: bash path unchanged without shell opt', () => {
  const r = parseShell('echo "hello world"');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.cmd, 'echo');
  assert.deepEqual(r.segments[0]?.args, ['hello world']);
});

test('powershell: standalone parsePowerShell export works', () => {
  const r = parsePowerShell('pwd');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments[0]?.cmd, 'pwd');
});
