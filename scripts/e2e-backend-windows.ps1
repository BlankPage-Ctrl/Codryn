#Requires -Version 5.1
<#
E2E test for the compiled Codryn backend binary plus fetched sidecars (Windows).

Mirrors scripts/e2e-backend.sh stages 0-4. e2e-backend.sh stays Linux-only;
this file is the Windows counterpart (runs under pwsh, no Git Bash needed).

usage (from the repo root):
  pwsh scripts/e2e-backend-windows.ps1 [-OutDir <dir>] [-Port 19123] [-BootTimeoutSecs 60]

What it checks (fail fast, exit non-zero on any failure):
  0. layout: codryn.exe, insight/ binary, rg/ binary exist and run
  1. HTTP auth negative: default boot requires HMAC (401 without headers)
  2. HTTP functional (AUTH_ENABLED=false): workspace CRUD, file list/read,
     file search, insight status endpoint, provider list
  3. rg sidecar directly: rg --json finds a planted marker
  4. STDIO transport: list.workspace + read.file over JSON-RPC
#>
param(
  [string]$OutDir = '',
  [int]$Port = 19123,
  [string]$ServerHost = '127.0.0.1',
  [int]$BootTimeoutSecs = 60
)

$ErrorActionPreference = 'Stop'

if ($env:E2E_PORT) { $Port = [int]$env:E2E_PORT }

if ([string]::IsNullOrEmpty($OutDir)) {
  $pkgVer = (node -p "require('./package.json').version").Trim()
  $OutDir = "dist/build-$pkgVer-windows-amd64"
}

$Base = "http://${ServerHost}:$Port"
$MigrationsDir = Join-Path $OutDir 'drizzle'
$TmpBase = Join-Path $env:TEMP ('codryn-e2e-' + [guid]::NewGuid().ToString('N'))

$script:PassCount = 0
$script:ServerProc = $null
$script:SavedEnv = @{}
$script:Http = [System.Net.Http.HttpClient]::new()
$script:Http.Timeout = [System.TimeSpan]::FromSeconds(15)

function Log-Info([string]$msg) { Write-Host "[e2e] $msg" }
function Pass([string]$msg) { $script:PassCount++; Write-Host "[e2e] PASS $msg" }
function Fail([string]$msg) {
  Write-Host "[e2e] FAIL $msg"
  if (Test-Path (Join-Path $TmpBase 'server.out.log')) {
    Write-Host '--- server logs tail ---'
    Get-Content (Join-Path $TmpBase 'server.out.log') -Tail 50 -ErrorAction SilentlyContinue
    Get-Content (Join-Path $TmpBase 'server.err.log') -Tail 50 -ErrorAction SilentlyContinue
  }
  exit 1
}
function Require-Cmd([string]$cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "required command '$cmd' not found in PATH" }
}

# Extract .data when the HTTP envelope wraps the payload, else whole body.
function Get-JsonField([string]$text, [string]$field) {
  $obj = $text | ConvertFrom-Json
  $v = $obj
  if ($null -ne $obj.data) { $v = $obj.data }
  if ($field -eq '.') { return ($v | ConvertTo-Json -Compress -Depth 20) }
  $val = $v.$field
  if ($null -eq $val) { return '' }
  return [string]$val
}

function Get-StatusCode([string]$url) {
  try {
    $resp = $script:Http.GetAsync($url).GetAwaiter().GetResult()
    return [string][int]$resp.StatusCode
  } catch { return '000' }
}

function Wait-ForCode([string]$want, [string]$url) {
  for ($i = 1; $i -le $BootTimeoutSecs; $i++) {
    if ((Get-StatusCode $url) -eq $want) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Save-Env([string]$name) { $script:SavedEnv[$name] = (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value }
function Restore-Env([string]$name) {
  if ($null -eq $script:SavedEnv[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  else { Set-Item "Env:$name" $script:SavedEnv[$name] }
}

function Start-Server([string]$dataDir, [string]$authEnabled) {
  Save-Env 'APP_MIGRATIONS_DIR'
  Save-Env 'AUTH_ENABLED'
  $env:APP_MIGRATIONS_DIR = $MigrationsDir
  if ($null -ne $authEnabled) { $env:AUTH_ENABLED = $authEnabled }
  else { Remove-Item Env:AUTH_ENABLED -ErrorAction SilentlyContinue }
  $outLog = Join-Path $TmpBase 'server.out.log'
  $errLog = Join-Path $TmpBase 'server.err.log'
  $script:ServerProc = Start-Process -FilePath $script:Bin `
    -ArgumentList @('--data-dir', $dataDir, '--host', $ServerHost, '--port', "$Port") `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
    -NoNewWindow -PassThru
}

function Stop-Server {
  if ($null -ne $script:ServerProc -and -not $script:ServerProc.HasExited) {
    Stop-Process -Id $script:ServerProc.Id -Force -ErrorAction SilentlyContinue
    $script:ServerProc.WaitForExit(10000)
  }
  $script:ServerProc = $null
  Restore-Env 'APP_MIGRATIONS_DIR'
  Restore-Env 'AUTH_ENABLED'
}

# Node STDIO driver: same protocol as the bash heredoc driver in
# e2e-backend.sh stage 4 (spawn binary with TRANSPORT=stdio, one request at
# a time, close stdin only after the last response).
$StdioDriverJs = @'
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const [bin, dataDir, port, wsDir, migDir] = process.argv.slice(2);
const stdioLog = process.env.STDIO_LOG || '/dev/null';
const child = spawn(bin, ['--data-dir', dataDir, '--host', '127.0.0.1', '--port', port], {
  env: { ...process.env, TRANSPORT: 'stdio', APP_MIGRATIONS_DIR: migDir },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.on('error', (err) => {
  console.error('STDIO_DRIVER_FAIL spawn: ' + err.message);
  process.exit(1);
});
child.stderr.on('data', (d) => { try { fs.appendFileSync(stdioLog, d); } catch (e) {} });
let buf = '';
const pending = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg && msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
function send(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(req.id);
      reject(new Error('timeout waiting for response id ' + req.id));
    }, timeoutMs || 60000);
    pending.set(req.id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify(req) + '\n');
  });
}
(async () => {
  const r1 = await send({ jsonrpc: '2.0', id: 1, method: 'list.workspace', params: {} });
  if (r1.error) throw new Error('list.workspace: ' + JSON.stringify(r1.error));
  const r2 = await send({ jsonrpc: '2.0', id: 2, method: 'create.workspace', params: { name: 'e2e-stdio', projectPath: wsDir } });
  if (r2.error) throw new Error('create.workspace: ' + JSON.stringify(r2.error));
  const wsId = r2.result && r2.result.id;
  if (!wsId) throw new Error('create.workspace returned no id: ' + JSON.stringify(r2));
  const r3 = await send({ jsonrpc: '2.0', id: 3, method: 'read.file', params: { workspaceId: wsId, path: 'note.txt' } });
  if (r3.error) throw new Error('read.file: ' + JSON.stringify(r3.error));
  if (!JSON.stringify(r3.result).includes('MARKER_ABC123')) {
    throw new Error('read.file misses marker: ' + JSON.stringify(r3.result).slice(0, 300));
  }
  process.stdout.write(String(wsId));
  child.stdin.end();
  await new Promise((resolve) => child.on('exit', resolve));
})().catch((err) => {
  console.error('STDIO_DRIVER_FAIL ' + err.message);
  try { child.kill(); } catch (e) {}
  process.exit(1);
});
'@

try {
  Require-Cmd 'node'

  if (-not (Test-Path -PathType Container $OutDir)) { Fail "OUTDIR '$OutDir' not found" }
  if (-not (Test-Path -PathType Leaf (Join-Path $MigrationsDir 'meta/_journal.json'))) {
    Fail "migrations not staged in $MigrationsDir (run make build-backend)"
  }

  # --- 0. layout -----------------------------------------------------------
  $script:Bin = Join-Path $OutDir 'codryn.exe'
  if (-not (Test-Path -PathType Leaf $script:Bin)) { Fail "backend binary not found in $OutDir (want codryn.exe)" }

  $InsightBin = Get-ChildItem (Join-Path $OutDir 'insight') -File | Select-Object -First 1
  if ($null -eq $InsightBin) { Fail "no binary found in $OutDir/insight (run make build-fetch)" }
  $RgBin = Get-ChildItem (Join-Path $OutDir 'rg') -File -Filter 'rg-v*-x86_64-*.exe' | Select-Object -First 1
  if ($null -eq $RgBin) { Fail "no versioned rg binary found in $OutDir/rg (want rg-v<semver>-<triple>.exe, run make build-fetch)" }
  if ($RgBin.Name -notmatch '^rg-v(\d+\.\d+\.\d+)-x86_64-') { Fail "rg binary name has no explicit version: $($RgBin.Name)" }

  Log-Info "BIN=$script:Bin"
  Log-Info "INSIGHT_BIN=$($InsightBin.FullName)"
  Log-Info "RG_BIN=$($RgBin.FullName)"

  $iv = (& $InsightBin.FullName version 2>&1 | Out-String)
  if ($iv -notmatch '\d+\.\d+\.\d+') { Fail 'insight binary did not report a version' }
  Pass 'insight binary reports a version'

  $rv = (& $RgBin.FullName --version 2>&1 | Out-String)
  if ($rv -notmatch 'ripgrep \d+') { Fail 'rg binary did not report a version' }
  $RgFileVersion = $Matches[0]
  if ($rv -notmatch [regex]::Escape($RgFileVersion)) { Fail "rg --version does not contain file-name version $RgFileVersion" }
  Pass "rg binary reports a version ($RgFileVersion)"

  $help = (& $script:Bin --help 2>&1 | Out-String)
  if ($help -notmatch 'codryn') { Fail "'$script:Bin --help' did not mention codryn" }
  Pass 'backend binary --help works'

  New-Item -ItemType Directory -Force -Path $TmpBase | Out-Null

  # --- 1. auth negative ----------------------------------------------------
  Log-Info 'stage 1: auth must reject unauthenticated requests (401)'
  Start-Server (Join-Path $TmpBase 'auth-data') $null
  try {
    if (-not (Wait-ForCode '401' "$Base/workspaces")) { Fail 'server did not answer 401 on GET /workspaces (auth negative)' }
    Pass 'unauthenticated GET /workspaces returns 401'
  } finally { Stop-Server }

  # --- 2. functional HTTP --------------------------------------------------
  Log-Info 'stage 2: functional HTTP with AUTH_ENABLED=false'
  $DataDir = Join-Path $TmpBase 'data'
  $WsDir = Join-Path $TmpBase 'ws'
  New-Item -ItemType Directory -Force -Path (Join-Path $WsDir 'sub') | Out-Null
  Set-Content (Join-Path $WsDir 'note.txt') 'hello e2e MARKER_ABC123' -Encoding ascii -NoNewline
  Set-Content (Join-Path $WsDir 'sub/other.txt') 'second file' -Encoding ascii -NoNewline

  Start-Server $DataDir 'false'
  try {
    if (-not (Wait-ForCode '200' "$Base/workspaces")) { Fail 'server did not become ready (GET /workspaces never 200)' }
    Pass 'server boots and GET /workspaces returns 200'

    $createBody = @{ name = 'e2e'; projectPath = $WsDir } | ConvertTo-Json -Compress
    $createContent = [System.Net.Http.StringContent]::new($createBody, [System.Text.Encoding]::UTF8, 'application/json')
    $createResp = $script:Http.PostAsync("$Base/workspaces", $createContent).GetAwaiter().GetResult()
    $createText = $createResp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $WsId = Get-JsonField $createText 'id'
    if ([string]::IsNullOrEmpty($WsId)) { Fail "POST /workspaces did not return an id: $createText" }
    Pass "POST /workspaces creates workspace ($WsId)"

    $getOne = $script:Http.GetStringAsync("$Base/workspaces/$WsId").GetAwaiter().GetResult()
    if ($getOne -notmatch [regex]::Escape($WsId)) { Fail "GET /workspaces/:id mismatch: $getOne" }
    Pass 'GET /workspaces/:id returns the workspace'

    $listFiles = $script:Http.GetStringAsync("$Base/workspaces/$WsId/files?path=").GetAwaiter().GetResult()
    if ($listFiles -notmatch 'note\.txt') { Fail "file list misses note.txt: $listFiles" }
    Pass 'GET files lists workspace files'

    $readFile = $script:Http.GetStringAsync("$Base/workspaces/$WsId/files/read?path=note.txt").GetAwaiter().GetResult()
    if ($readFile -notmatch 'MARKER_ABC123') { Fail "file read misses marker: $readFile" }
    Pass 'GET files/read returns file content'

    # NOTE: files/search matches file names/paths, not file contents
    # (content search lives behind the agent grep tool / rg sidecar, stage 3).
    $search = $script:Http.GetStringAsync("$Base/workspaces/$WsId/files/search?query=note").GetAwaiter().GetResult()
    if ($search -notmatch 'note\.txt') { Fail "file search misses note.txt: $search" }
    Pass 'GET files/search finds by file name'

    if ((Get-StatusCode "$Base/workspaces/$WsId/insight/status") -ne '200') { Fail 'insight status did not return 200' }
    Pass 'GET insight/status returns 200'

    if ((Get-StatusCode "$Base/providers") -ne '200') { Fail 'GET /providers did not return 200' }
    Pass 'GET /providers returns 200'
  } finally { Stop-Server }

  # --- 3. rg sidecar directly ----------------------------------------------
  Log-Info 'stage 3: rg sidecar search'
  $rgHit = (& $RgBin.FullName --json --line-number --column --no-heading --no-require-git --case-sensitive -- MARKER_ABC123 $WsDir 2>&1 | Out-String)
  if ($rgHit -notmatch 'note\.txt') { Fail 'rg --json did not hit note.txt' }
  Pass 'rg --json finds the planted marker'

  # --- 4. STDIO transport --------------------------------------------------
  # NOTE: stdio exits on stdin EOF, racing in-flight dispatches. Drive it
  # interactively (one request at a time, close stdin only after the last
  # response), same as the bash version.
  Log-Info 'stage 4: STDIO JSON-RPC (TRANSPORT=stdio, no auth by design)'
  $StdioData = Join-Path $TmpBase 'stdio-data'
  New-Item -ItemType Directory -Force -Path $StdioData | Out-Null
  $driverFile = Join-Path $TmpBase 'stdio-driver.js'
  Set-Content $driverFile $StdioDriverJs -Encoding ascii
  $env:STDIO_LOG = Join-Path $TmpBase 'stdio.log'
  $StdioWsId = (& node $driverFile $script:Bin $StdioData "$Port" $WsDir $MigrationsDir 2>(Join-Path $TmpBase 'stdio-driver.log') | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { Fail 'stdio session failed' }
  Remove-Item Env:STDIO_LOG -ErrorAction SilentlyContinue
  if ([string]::IsNullOrEmpty($StdioWsId)) { Fail 'stdio session returned empty workspace id' }
  Pass "stdio list.workspace + create.workspace respond without errors ($StdioWsId)"
  Pass 'stdio read.file returns file content'

  Log-Info "E2E done: $script:PassCount checks passed (OUTDIR=$OutDir)"
} finally {
  Stop-Server
  Remove-Item -Recurse -Force $TmpBase -ErrorAction SilentlyContinue
}
