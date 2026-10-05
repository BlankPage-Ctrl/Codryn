# Codryn installer for Windows.
#
# What it does:
#   1. Downloads the latest Codryn backend zip for windows-amd64.
#   2. Extracts it and FLATTENS the contents into ~/.codryn/backend/bin
#      (never ~/.codryn/backend/bin/build-<ver>-<os>-<arch>/...).
#   3. Adds that bin dir to the USER Path (current session + persisted).
#   4. Downloads the Codryn desktop Inno Setup installer and runs it silent:
#        /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="%TEMP%\codryn-install.log"
#      (flags documented in Codryn-Desktop/packaging/windows/codryn.iss).
#
# Release assets (see .github/workflows/release-*.yml and Makefile):
#   Backend: https://github.com/BlankPage-Ctrl/Codryn/releases/download/v<VER>/codryn-backend-<VER>-windows-amd64.zip
#     zip contains one top folder: build-<VER>-windows-amd64/
#       codryn.exe  drizzle/  insight/  rg/  skills/
#   Desktop: https://github.com/BlankPage-Ctrl/Codryn-Desktop/releases/download/v<VER>/codryn-desktop-<VER>-setup-windows-amd64.exe
#     plus portable fallback: codryn-desktop-<VER>-windows-amd64.zip
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File installs/install.ps1
#   powershell -ExecutionPolicy Bypass -File installs/install.ps1 -Version 0.0.1 -DesktopVersion 0.0.1
#   powershell -ExecutionPolicy Bypass -File installs/install.ps1 -SkipDesktop
[CmdletBinding()]
param(
  [string]$Version = "latest",
  [string]$DesktopVersion = "latest",
  [switch]$SkipDesktop,
  [string]$InstallDir = (Join-Path $HOME ".codryn\backend\bin"),
  [string]$DesktopArgs = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART"
)

$ErrorActionPreference = "Stop"

$BackendRepo = "BlankPage-Ctrl/Codryn"
$DesktopRepo = "BlankPage-Ctrl/Codryn-Desktop"

function Strip-V($v) { return ($v -replace '^[vV]', '') }

function Resolve-LatestTag($repo) {
  $url = "https://api.github.com/repos/$repo/releases/latest"
  try {
    $rel = Invoke-RestMethod -Uri $url -UseBasicParsing
  } catch {
    throw "could not resolve latest release for $repo (check network): $($_.Exception.Message)"
  }
  if ([string]::IsNullOrEmpty($rel.tag_name)) { throw "latest release for $repo has no tag_name" }
  return $rel.tag_name
}

# Only amd64 assets are published (SrcInsight v.0.0.10 ships linux/windows amd64 only; see Makefile).
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne "AMD64") {
  throw "unsupported arch: $arch (stub: only amd64 has published backend/desktop assets)"
}

if ([string]::IsNullOrEmpty($Version) -or $Version -eq "latest") {
  $tag = Resolve-LatestTag $BackendRepo
  $ver = Strip-V $tag
} else {
  $ver = Strip-V $Version
  $tag = "v$ver"
}

if ([string]::IsNullOrEmpty($DesktopVersion) -or $DesktopVersion -eq "latest") {
  $dtag = Resolve-LatestTag $DesktopRepo
  $dver = Strip-V $dtag
} else {
  $dver = Strip-V $DesktopVersion
  $dtag = "v$dver"
}

Write-Host "==> Codryn backend $tag (windows-amd64) + desktop $dtag (windows-amd64)"

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("codryn-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  # --- 1. Backend: download, extract, FLATTEN into $InstallDir. ---
  $zipName = "codryn-backend-$ver-windows-amd64.zip"
  $zipUrl = "https://github.com/$BackendRepo/releases/download/$tag/$zipName"
  $zipPath = Join-Path $tmp $zipName
  Write-Host "==> downloading backend: $zipUrl"
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

  $extractDir = Join-Path $tmp "backend"
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  # The zip wraps everything in one build-<ver>-windows-amd64/ folder.
  # The backend only looks NEXT TO the executable (drizzle/, skills/builtin)
  # and in ~/.codryn/backend/bin/{insight,rg}, so a nested build folder would
  # break insight, ripgrep, skills and migrations. Flatten it.
  $buildDir = Get-ChildItem -Path $extractDir -Directory -Filter "build-*" | Select-Object -First 1
  if ($null -eq $buildDir) { throw "unexpected backend zip layout: no build-*/ folder found" }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -Path (Join-Path $buildDir.FullName "*") -Destination $InstallDir -Recurse -Force

  # Verify the flattened layout the backend expects.
  if (-not (Test-Path (Join-Path $InstallDir "codryn.exe"))) { throw "backend install incomplete: codryn.exe missing in $InstallDir" }
  if (-not (Test-Path (Join-Path $InstallDir "drizzle\meta\_journal.json"))) { throw "backend install incomplete: drizzle migrations missing in $InstallDir" }
  if (-not (Test-Path (Join-Path $InstallDir "insight"))) { throw "backend install incomplete: insight\ missing in $InstallDir" }
  if (-not (Test-Path (Join-Path $InstallDir "rg"))) { throw "backend install incomplete: rg\ missing in $InstallDir" }
  if (@(Get-ChildItem -Path (Join-Path $InstallDir "skills") -Filter "SKILL.md" -Recurse -ErrorAction SilentlyContinue).Count -eq 0) {
    throw "backend install incomplete: builtin skills missing in $InstallDir\skills"
  }
  Write-Host "==> backend installed to $InstallDir"

  # --- 2. PATH: persist $InstallDir on USER Path (no admin needed). ---
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ([string]::IsNullOrEmpty($userPath)) { $userPath = "" }
  $parts = $userPath -split ";" | Where-Object { $_ -ne "" }
  $already = $false
  foreach ($p in $parts) {
    if ($p.TrimEnd("\") -ieq $InstallDir.TrimEnd("\")) { $already = $true; break }
  }
  if (-not $already) {
    $newPath = if ($userPath -eq "") { $InstallDir } else { "$userPath;$InstallDir" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "==> added $InstallDir to user PATH"
  } else {
    Write-Host "==> user PATH already contains $InstallDir"
  }
  $sessionHasBin = @($env:Path -split ";" | Where-Object { $_ -ne "" } | ForEach-Object { $_.TrimEnd("\") } | Where-Object { $_ -ieq $InstallDir.TrimEnd("\") }).Count -gt 0
  if (-not $sessionHasBin) {
    $env:Path = "$env:Path;$InstallDir"
  }

  # --- 3. Desktop (Inno Setup, silent). ---
  if ($SkipDesktop) {
    Write-Host "==> skipping desktop (-SkipDesktop)"
  } else {
    $setupName = "codryn-desktop-$dver-setup-windows-amd64.exe"
    $setupUrl = "https://github.com/$DesktopRepo/releases/download/$dtag/$setupName"
    $setupPath = Join-Path $tmp $setupName
    $installed = $false
    try {
      Write-Host "==> downloading desktop (setup): $setupUrl"
      Invoke-WebRequest -Uri $setupUrl -OutFile $setupPath -UseBasicParsing
      $logPath = Join-Path ([IO.Path]::GetTempPath()) "codryn-install.log"
      $setupArgs = "$DesktopArgs /LOG=`"$logPath`""
      Write-Host "==> installing desktop (silent): $setupName $setupArgs"
      $proc = Start-Process -FilePath $setupPath -ArgumentList $setupArgs -Wait -PassThru
      if ($proc.ExitCode -ne 0) { throw "desktop setup exited with code $($proc.ExitCode) (see $logPath)" }
      Write-Host "==> desktop installed (log: $logPath)"
      if (Test-Path $logPath) {
        $webviewWarn = Select-String -Path $logPath -Pattern "WebView2" -SimpleMatch -ErrorAction SilentlyContinue
        if ($webviewWarn) {
          Write-Warning "Setup log mentions WebView2 (Codryn needs the WebView2 Runtime to run): https://go.microsoft.com/fwlink/p/?LinkId=2124703"
        }
      }
      $installed = $true
    } catch {
      Write-Warning "setup installer failed ($($_.Exception.Message)); falling back to portable zip"
    }
    if (-not $installed) {
      $portName = "codryn-desktop-$dver-windows-amd64.zip"
      $portUrl = "https://github.com/$DesktopRepo/releases/download/$dtag/$portName"
      $portPath = Join-Path $tmp $portName
      Write-Host "==> downloading desktop (portable): $portUrl"
      Invoke-WebRequest -Uri $portUrl -OutFile $portPath -UseBasicParsing
      $portDir = Join-Path $tmp "desktop-portable"
      Expand-Archive -Path $portPath -DestinationPath $portDir -Force
      $exe = Get-ChildItem -Path $portDir -Filter "codryn-desktop.exe" -Recurse | Select-Object -First 1
      if ($null -eq $exe) { throw "unexpected desktop zip layout: codryn-desktop.exe not found" }
      $deskDir = Join-Path $HOME ".codryn\desktop"
      New-Item -ItemType Directory -Force -Path $deskDir | Out-Null
      Copy-Item -Path $exe.FullName -Destination (Join-Path $deskDir "codryn-desktop.exe") -Force
      Write-Host "==> desktop (portable) installed to $deskDir\codryn-desktop.exe"
    }
  }

  Write-Host "==> done."
  Write-Host "    backend: $(Join-Path $InstallDir 'codryn.exe')"
  try {
    & (Join-Path $InstallDir "codryn.exe") --version 2>&1 | Select-Object -First 2
  } catch {
    Write-Warning "backend version probe failed: $($_.Exception.Message)"
  }
  Write-Host "    (open a NEW terminal so the updated PATH takes effect)"
} finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
