#!/usr/bin/env bash
# E2E test for the compiled Codryn backend binary plus fetched sidecars.
#
# usage: bash scripts/e2e-backend.sh [OUTDIR]
#   OUTDIR defaults to dist/build-<pkg-version>-linux-amd64
#
# What it checks (fail fast, exit non-zero on any failure):
#   0. layout: codryn binary, insight/ binary, rg/ binary exist and run
#   1. HTTP auth negative: default boot requires HMAC (401 without headers)
#   2. HTTP functional (AUTH_ENABLED=false): workspace CRUD, file list/read,
#      file search, insight status endpoint, provider list
#   3. rg sidecar directly: rg --json finds a planted marker
#   4. STDIO transport: list.workspace + read.file over JSON-RPC
#
# Notes:
# - Comment style: plain ASCII only (repo rule).
# - Needs: curl, node. Server boot waits up to BOOT_TIMEOUT_SECS.

set -euo pipefail

OUTDIR="${1:-dist/build-$(node -p "require('./package.json').version")-linux-amd64}"
PORT="${E2E_PORT:-19123}"
HOST="127.0.0.1"
BASE="http://$HOST:$PORT"
BOOT_TIMEOUT_SECS="${BOOT_TIMEOUT_SECS:-60}"

PASS_COUNT=0

log() { printf '[e2e] %s\n' "$*"; }
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf '[e2e] PASS %s\n' "$*"; }
fail() { printf '[e2e] FAIL %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null || fail "required command '$1' not found in PATH"
}

# Extract .data when the HTTP envelope wraps the payload, else whole body.
json_get() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const b=JSON.parse(s);const v=(b&&typeof b==='object'&&'data'in b)?b.data:b;const out=process.argv[1]==='.'?JSON.stringify(v):(((v??{})[process.argv[1]])??'');process.stdout.write(String(out));}catch(e){process.exit(1);}})" "$1"
}

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" || true
}

wait_for_code() {
  local want="$1" url="$2" i code
  for i in $(seq 1 "$BOOT_TIMEOUT_SECS"); do
    code="$(http_code "$url")"
    if [ "$code" = "$want" ]; then return 0; fi
    sleep 1
  done
  return 1
}

require_cmd curl
require_cmd node

[ -d "$OUTDIR" ] || fail "OUTDIR '$OUTDIR' not found"

# The compiled binary resolves migrations via APP_MIGRATIONS_DIR
# (its $bunfs import.meta.url has no drizzle/ sibling). The dist layout
# stages them at $OUTDIR/drizzle (see Makefile build-backend).
MIGRATIONS_DIR="$OUTDIR/drizzle"
[ -f "$MIGRATIONS_DIR/meta/_journal.json" ] \
  || fail "migrations not staged in $MIGRATIONS_DIR (run make build-backend)"

# --- 0. layout -------------------------------------------------------------
if [ -x "$OUTDIR/codryn" ]; then
  BIN="$OUTDIR/codryn"
elif [ -f "$OUTDIR/codryn.exe" ]; then
  fail "found codryn.exe (windows build) but E2E runs on $(uname -s); run the matching native build"
else
  fail "backend binary not found in $OUTDIR (want codryn or codryn.exe)"
fi

INSIGHT_BIN="$(find "$OUTDIR/insight" -type f | head -n 1)"
[ -n "$INSIGHT_BIN" ] || fail "no binary found in $OUTDIR/insight (run make build-fetch)"
RG_BIN="$(find "$OUTDIR/rg" -type f -name 'rg-v*-x86_64-*' | head -n 1)"
[ -n "$RG_BIN" ] || fail "no versioned rg binary found in $OUTDIR/rg (want rg-v<semver>-<triple>, run make build-fetch)"
case "$RG_BIN" in
  *rg-v[0-9]*.[0-9]*.[0-9]*-x86_64-*) ;;
  *) fail "rg binary name has no explicit version: $RG_BIN";;
esac
if [ ! -x "$RG_BIN" ]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT) ;;
    *) fail "rg binary is not executable: $RG_BIN";;
  esac
fi

log "BIN=$BIN"
log "INSIGHT_BIN=$INSIGHT_BIN"
log "RG_BIN=$RG_BIN"

"$INSIGHT_BIN" version 2>&1 | grep -Eq '[0-9]+\.[0-9]+\.[0-9]+' \
  || fail "insight binary did not report a version"
pass "insight binary reports a version"

"$RG_BIN" --version 2>&1 | grep -Eq 'ripgrep [0-9]+' \
  || fail "rg binary did not report a version"
RG_FILE_VERSION="$(basename "$RG_BIN" | sed -n 's/^rg-v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)-.*/\1/p')"
[ -n "$RG_FILE_VERSION" ] || fail "rg binary name has no parseable version: $RG_BIN"
"$RG_BIN" --version 2>&1 | grep -Fq "$RG_FILE_VERSION" \
  || fail "rg --version does not contain file-name version $RG_FILE_VERSION"
pass "rg binary reports a version ($RG_FILE_VERSION)"

"$BIN" --help 2>&1 | grep -Eq 'codryn' \
  || fail "'$BIN --help' did not mention codryn"
pass "backend binary --help works"

TMPBASE="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$TMPBASE"
}
trap cleanup EXIT

start_server() {
  # $1 = data dir, $2... = extra env assignments (VAR=value)
  local datadir="$1"; shift
  env APP_MIGRATIONS_DIR="$MIGRATIONS_DIR" "$@" "$BIN" --data-dir "$datadir" --host "$HOST" --port "$PORT" \
    >"$TMPBASE/server.log" 2>&1 &
  SERVER_PID="$!"
}

stop_server() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

# --- 1. auth negative ------------------------------------------------------
log "stage 1: auth must reject unauthenticated requests (401)"
start_server "$TMPBASE/auth-data"
if ! wait_for_code 401 "$BASE/workspaces"; then
  log "--- server.log tail ---"
  tail -n 50 "$TMPBASE/server.log" || true
  fail "server did not answer 401 on GET /workspaces (auth negative)"
fi
pass "unauthenticated GET /workspaces returns 401"
stop_server

# --- 2. functional HTTP ----------------------------------------------------
log "stage 2: functional HTTP with AUTH_ENABLED=false"
DATA_DIR="$TMPBASE/data"
WS_DIR="$TMPBASE/ws"
mkdir -p "$WS_DIR"
echo 'hello e2e MARKER_ABC123' >"$WS_DIR/note.txt"
mkdir -p "$WS_DIR/sub"
echo 'second file' >"$WS_DIR/sub/other.txt"

start_server "$DATA_DIR" AUTH_ENABLED=false
if ! wait_for_code 200 "$BASE/workspaces"; then
  log "--- server.log tail ---"
  tail -n 50 "$TMPBASE/server.log" || true
  fail "server did not become ready (GET /workspaces never 200)"
fi
pass "server boots and GET /workspaces returns 200"

CREATE_RESP="$(curl -s --max-time 15 -X POST "$BASE/workspaces" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"e2e\",\"projectPath\":\"$WS_DIR\"}")"
WS_ID="$(printf '%s' "$CREATE_RESP" | json_get id)"
[ -n "$WS_ID" ] || fail "POST /workspaces did not return an id: $CREATE_RESP"
pass "POST /workspaces creates workspace ($WS_ID)"

GET_ONE="$(curl -s --max-time 15 "$BASE/workspaces/$WS_ID")"
echo "$GET_ONE" | grep -q "$WS_ID" || fail "GET /workspaces/:id mismatch: $GET_ONE"
pass "GET /workspaces/:id returns the workspace"

LIST_FILES="$(curl -s --max-time 15 "$BASE/workspaces/$WS_ID/files?path=")"
echo "$LIST_FILES" | grep -q 'note.txt' || fail "file list misses note.txt: $LIST_FILES"
pass "GET files lists workspace files"

READ_FILE="$(curl -s --max-time 15 "$BASE/workspaces/$WS_ID/files/read?path=note.txt")"
echo "$READ_FILE" | grep -q 'MARKER_ABC123' || fail "file read misses marker: $READ_FILE"
pass "GET files/read returns file content"

# NOTE: files/search matches file names/paths, not file contents
# (content search lives behind the agent grep tool / rg sidecar, stage 3).
SEARCH="$(curl -s --max-time 15 "$BASE/workspaces/$WS_ID/files/search?query=note")"
echo "$SEARCH" | grep -q 'note.txt' || fail "file search misses note.txt: $SEARCH"
pass "GET files/search finds by file name"

INSIGHT_STATUS_CODE="$(http_code "$BASE/workspaces/$WS_ID/insight/status")"
[ "$INSIGHT_STATUS_CODE" = "200" ] || fail "insight status returned $INSIGHT_STATUS_CODE"
pass "GET insight/status returns 200"

PROVIDERS_CODE="$(http_code "$BASE/providers")"
[ "$PROVIDERS_CODE" = "200" ] || fail "GET /providers returned $PROVIDERS_CODE"
pass "GET /providers returns 200"
stop_server

# --- 3. rg sidecar directly ------------------------------------------------
log "stage 3: rg sidecar search"
RG_HIT="$("$RG_BIN" --json --line-number --column --no-heading --no-require-git \
  --case-sensitive -- MARKER_ABC123 "$WS_DIR" | head -n 5)"
echo "$RG_HIT" | grep -q 'note.txt' || fail "rg --json did not hit note.txt"
pass "rg --json finds the planted marker"

# --- 4. STDIO transport ----------------------------------------------------
# NOTE: stdio exits on stdin EOF, racing in-flight dispatches. Drive it
# interactively (one request at a time, close stdin only after the last
# response) instead of piping a fixed file.
log "stage 4: STDIO JSON-RPC (TRANSPORT=stdio, no auth by design)"
STDIO_DATA="$TMPBASE/stdio-data"
mkdir -p "$STDIO_DATA"
STDIO_WS_ID="$(STDIO_LOG="$TMPBASE/stdio.log" node - "$BIN" "$STDIO_DATA" "$PORT" "$WS_DIR" "$MIGRATIONS_DIR" 2>"$TMPBASE/stdio-driver.log" <<'EOF'
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
EOF
)" || fail "stdio session failed; log tail: $(tail -n 20 "$TMPBASE/stdio.log")"
[ -n "$STDIO_WS_ID" ] || fail "stdio session returned empty workspace id"
pass "stdio list.workspace + create.workspace respond without errors ($STDIO_WS_ID)"
pass "stdio read.file returns file content"

log "E2E done: $PASS_COUNT checks passed (OUTDIR=$OUTDIR)"
