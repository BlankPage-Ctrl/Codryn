#!/usr/bin/env bash
# Codryn installer for Linux (macOS is a stub: not supported yet).
#
# What it does:
#   1. Downloads the latest Codryn backend zip for this OS/arch.
#   2. Extracts it and FLATTENS the contents into ~/.codryn/backend/bin
#      (never ~/.codryn/backend/bin/build-<ver>-<os>-<arch>/...).
#   3. Adds ~/.codryn/backend/bin to PATH via shell rc files.
#   4. Installs the Codryn desktop client (.deb via sudo, tarball fallback).
#
# Release assets (see .github/workflows/release-*.yml and Makefile):
#   Backend: https://github.com/BlankPage-Ctrl/Codryn/releases/download/v<VER>/codryn-backend-<VER>-linux-amd64.zip
#     zip contains one top folder: build-<VER>-linux-amd64/
#       codryn  drizzle/  insight/  rg/  skills/
#   Desktop: https://github.com/BlankPage-Ctrl/Codryn-Desktop/releases/download/v<VER>/codryn-desktop_<VER>-1_amd64.deb
#     plus portable fallback: codryn-desktop-<VER>-linux-amd64.tar.gz
#
# Usage:
#   bash installs/install.sh
#   CODRYN_VERSION=0.0.1 CODRYN_DESKTOP_VERSION=0.0.1 bash installs/install.sh
#   SKIP_DESKTOP=1 bash installs/install.sh     # backend only
#
# Env:
#   CODRYN_VERSION          backend version: "latest" (default), "v1.2.3" or "1.2.3"
#   CODRYN_DESKTOP_VERSION  desktop version: "latest" (default), "v1.2.3" or "1.2.3"
#   SKIP_DESKTOP            set to 1 to skip the desktop install
#   CODRYN_DESKTOP_PORTABLE set to 1 to force the portable tarball (no sudo)
set -eu -o pipefail

BACKEND_REPO="BlankPage-Ctrl/Codryn"
DESKTOP_REPO="BlankPage-Ctrl/Codryn-Desktop"
CODRYN_VERSION="${CODRYN_VERSION:-latest}"
CODRYN_DESKTOP_VERSION="${CODRYN_DESKTOP_VERSION:-latest}"
SKIP_DESKTOP="${SKIP_DESKTOP:-0}"
CODRYN_DESKTOP_PORTABLE="${CODRYN_DESKTOP_PORTABLE:-0}"

BIN_DIR="$HOME/.codryn/backend/bin"
DESKTOP_DIR="$HOME/.codryn/desktop"

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# --- macOS stub: Codryn does not support macOS yet. ---
OS_NAME="$(uname -s)"
if [ "$OS_NAME" = "Darwin" ]; then
  die "Codryn does not support macOS yet. Only Linux (amd64) and Windows (amd64) releases are published."
fi
[ "$OS_NAME" = "Linux" ] || die "unsupported OS: $OS_NAME (want Linux; macOS is not supported yet)"

ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  x86_64|amd64) ARCH="amd64" ;;
  *) die "unsupported arch: $ARCH_RAW (stub: only amd64 has published backend/desktop assets)" ;;
esac

for cmd in curl unzip; do
  command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
done

# Strip a leading "v"/"V" so "v1.2.3" and "1.2.3" both work.
strip_v() { printf '%s' "$1" | sed 's/^[vV]//'; }

resolve_latest() {
  local repo="$1" tag
  tag="$(curl -fsSL --retry 3 "https://api.github.com/repos/$repo/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$tag" ] || die "could not resolve latest release for $repo (check network / API rate limits)"
  printf '%s' "$tag"
}

if [ "$CODRYN_VERSION" = "latest" ] || [ -z "$CODRYN_VERSION" ]; then
  TAG="$(resolve_latest "$BACKEND_REPO")"
  VER="$(strip_v "$TAG")"
else
  VER="$(strip_v "$CODRYN_VERSION")"
  TAG="v$VER"
fi

if [ "$CODRYN_DESKTOP_VERSION" = "latest" ] || [ -z "$CODRYN_DESKTOP_VERSION" ]; then
  DTAG="$(resolve_latest "$DESKTOP_REPO")"
  DVER="$(strip_v "$DTAG")"
else
  DVER="$(strip_v "$CODRYN_DESKTOP_VERSION")"
  DTAG="v$DVER"
fi

log "==> Codryn backend $TAG ($ARCH) + desktop $DTAG ($ARCH)"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# --- 1. Backend: download, extract, FLATTEN into ~/.codryn/backend/bin. ---
BACKEND_ZIP="codryn-backend-${VER}-linux-${ARCH}.zip"
BACKEND_URL="https://github.com/${BACKEND_REPO}/releases/download/${TAG}/${BACKEND_ZIP}"
log "==> downloading backend: $BACKEND_URL"
curl -fL --retry 3 -o "$TMPDIR/$BACKEND_ZIP" "$BACKEND_URL"

log "==> extracting backend"
unzip -o -q "$TMPDIR/$BACKEND_ZIP" -d "$TMPDIR/backend"

# The zip wraps everything in one build-<ver>-<os>-<arch>/ folder.
# The backend only looks NEXT TO the executable (drizzle/, skills/builtin)
# and in ~/.codryn/backend/bin/{insight,rg}, so a nested build folder would
# break insight, ripgrep, skills and migrations. Flatten it. (Makefile, apps/insight/constants.ts)
BUILD_DIR="$(find "$TMPDIR/backend" -maxdepth 2 -type d -name "build-*" | head -n 1)"
[ -n "$BUILD_DIR" ] || die "unexpected backend zip layout: no build-*/ folder found"

mkdir -p "$BIN_DIR"
# Copy (not move across filesystems blindly): contents only, no nesting.
cp -a "$BUILD_DIR"/. "$BIN_DIR/"
chmod +x "$BIN_DIR/codryn"
# Sidecars may lose +x through zip; restore it.
chmod +x "$BIN_DIR"/insight/* 2>/dev/null || true
chmod +x "$BIN_DIR"/rg/* 2>/dev/null || true

# Verify the flattened layout the backend expects.
[ -x "$BIN_DIR/codryn" ] || die "backend install incomplete: $BIN_DIR/codryn missing"
[ -f "$BIN_DIR/drizzle/meta/_journal.json" ] || die "backend install incomplete: $BIN_DIR/drizzle migrations missing"
[ -d "$BIN_DIR/insight" ] || die "backend install incomplete: $BIN_DIR/insight missing"
[ -d "$BIN_DIR/rg" ] || die "backend install incomplete: $BIN_DIR/rg missing"
[ -n "$(find "$BIN_DIR/skills" -name SKILL.md 2>/dev/null | head -n 1)" ] \
  || die "backend install incomplete: $BIN_DIR/skills builtin skills missing"
log "==> backend installed to $BIN_DIR"

# --- 2. PATH: persist ~/.codryn/backend/bin for future shells. ---
add_path_once() {
  local rc="$1"
  touch "$rc"
  if grep -Fq '.codryn/backend/bin' "$rc" 2>/dev/null; then return 0; fi
  {
    printf '\n# codryn (added by installs/install.sh)\n'
    printf 'export PATH="$HOME/.codryn/backend/bin:$PATH"\n'
  } >> "$rc"
  log "==> added ~/.codryn/backend/bin to PATH in $rc"
}

add_path_once "$HOME/.bashrc"
if [ -f "$HOME/.zshrc" ] || command -v zsh >/dev/null 2>&1; then
  add_path_once "$HOME/.zshrc"
fi
if command -v fish >/dev/null 2>&1; then
  FISH_CONF="$HOME/.config/fish/config.fish"
  mkdir -p "$(dirname "$FISH_CONF")"
  touch "$FISH_CONF"
  if ! grep -Fq '.codryn/backend/bin' "$FISH_CONF" 2>/dev/null; then
    printf '\n# codryn (added by installs/install.sh)\nfish_add_path "$HOME/.codryn/backend/bin"\n' >> "$FISH_CONF"
    log "==> added ~/.codryn/backend/bin to PATH in $FISH_CONF"
  fi
fi
export PATH="$BIN_DIR:$PATH"

# --- 3. Desktop. ---
if [ "$SKIP_DESKTOP" = "1" ]; then
  log "==> skipping desktop (SKIP_DESKTOP=1)"
else
  install_portable() {
    local tgz="codryn-desktop-${DVER}-linux-${ARCH}.tar.gz"
    local url="https://github.com/${DESKTOP_REPO}/releases/download/${DTAG}/${tgz}"
    log "==> downloading desktop (portable): $url"
    curl -fL --retry 3 -o "$TMPDIR/$tgz" "$url"
    mkdir -p "$DESKTOP_DIR"
    tar -xzf "$TMPDIR/$tgz" -C "$TMPDIR"
    local bin
    bin="$(find "$TMPDIR" -maxdepth 2 -type f -name 'codryn-desktop' | head -n 1)"
    [ -n "$bin" ] || die "unexpected desktop tarball layout: codryn-desktop binary not found"
    cp -a "$bin" "$DESKTOP_DIR/codryn-desktop"
    chmod +x "$DESKTOP_DIR/codryn-desktop"
    mkdir -p "$HOME/.local/bin"
    ln -sf "$DESKTOP_DIR/codryn-desktop" "$HOME/.local/bin/codryn-desktop"
    log "==> desktop (portable) installed to $DESKTOP_DIR/codryn-desktop (symlinked in ~/.local/bin)"
  }

  if [ "$CODRYN_DESKTOP_PORTABLE" = "1" ]; then
    install_portable
  else
    DEB="codryn-desktop_${DVER}-1_amd64.deb"
    DEB_URL="https://github.com/${DESKTOP_REPO}/releases/download/${DTAG}/${DEB}"
    log "==> downloading desktop (.deb): $DEB_URL"
    if curl -fL --retry 3 -o "$TMPDIR/$DEB" "$DEB_URL"; then
      log "==> installing desktop (.deb, needs sudo)"
      if sudo dpkg -i "$TMPDIR/$DEB"; then
        log "==> desktop installed via dpkg (codryn-desktop on PATH)"
      else
        log "==> dpkg failed, falling back to portable tarball"
        install_portable
      fi
    else
      log "==> .deb download failed, falling back to portable tarball"
      install_portable
    fi
  fi
fi

log "==> done. Restart your shell (or: source ~/.bashrc) so PATH picks up $BIN_DIR"
log "    backend: $BIN_DIR/codryn"
"$BIN_DIR/codryn" --version 2>&1 | head -n 2 || true
