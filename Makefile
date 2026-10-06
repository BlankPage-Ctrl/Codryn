# Three targets:
#   make build-backend OS=linux ARCH=amd64 VERSION=1.0.0
#   make build-fetch   OS=linux ARCH=amd64 VERSION=1.0.0
#   make build-test    OS=linux ARCH=amd64 VERSION=1.0.0
#
# Layout: dist/build-<version>-<os>-<arch>/
#   codryn[.exe]   single-file Bun binary (apps/index.ts)
#   insight/       SrcInsight binary (mirrors ~/.codryn/backend/bin/insight/)
#   rg/            ripgrep binary with explicit version in the file name
#                  (mirrors ~/.codryn/backend/bin/rg/), e.g.
#                  rg-v13.0.0-x86_64-unknown-linux-musl
#   skills/        builtin skill files (apps/skills/builtin); the compiled
#                  binary cannot see them through its $bunfs path, so they
#                  are staged next to the executable like drizzle/ above.
#
# Notes:
# - Builds are native per runner (no bun --target cross-compile).
#   Run the linux build on a linux runner and the windows build on a
#   windows runner (GitHub matrix).
# - SrcInsight v.0.0.10 only ships linux-amd64 and windows-amd64.
#   Any other ARCH fails fast with a clear stub message.

SHELL := /bin/bash
.ONESHELL:
.SHELLFLAGS := -eu -o pipefail -c
.PHONY: build-backend build-fetch build-test help

VERSION ?= $(shell node -p "require('./package.json').version")
OS ?= linux
ARCH ?= amd64

ENTRY := apps/index.ts
OUTDIR := dist/build-$(VERSION)-$(OS)-$(ARCH)

# SrcInsight release. Tag has a dot after v ("v.0.0.10"), do not rebuild it
# from INSIGHT_VERSION with a naive "v" prefix.
INSIGHT_VERSION ?= 0.0.10
INSIGHT_TAG := v.0.0.10
INSIGHT_REPO := https://github.com/BlankPage-Ctrl/SrcInsight/releases/download
INSIGHT_SHA256_linux := 0b8235eb58ec2dcd0f2560d6c4aa1bdeac97745f576073e11056b61f96b49ad9
INSIGHT_SHA256_windows := a710f72bafc916b1023f2af355e82b1246512cfe295f25e040a9b73af50ab784

# Ripgrep via Microsoft prebuilt (same source @vscode/ripgrep uses).
# NOTE: for x86_64 linux Microsoft only ships a musl (static) archive.
# If you override RG_PREBUILT_TAG you must also override both RG_SHA256_*.
# RG_VERSION is derived from the tag (v<version>-<rev>), so the fetched
# file name always carries an explicit version, e.g.
# rg-v13.0.0-x86_64-unknown-linux-musl. No plain "rg" output is kept.
RG_PREBUILT_TAG ?= v13.0.0-13
RG_VERSION = $(shell echo "$(RG_PREBUILT_TAG)" | sed -n 's/^v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)-.*/\1/p')
RG_TRIPLE_linux := x86_64-unknown-linux-musl
RG_TRIPLE_windows := x86_64-pc-windows-msvc
RG_REPO := https://github.com/microsoft/ripgrep-prebuilt/releases/download
RG_SHA256_linux := 324cd645481db1ceda8621409c9151fc58d182b90cc5c428db80edb21fb26df3
RG_SHA256_windows := 2eaba7d843375d92b7acf17953c6d981ba39414dffb9bae818917b980b55c771

ifeq ($(OS),windows)
BINNAME := codryn.exe
else
BINNAME := codryn
endif

# --- internal guards (run inside recipes) ---

build-backend:
	set -eu -o pipefail
	case "$(ARCH)" in \
	  amd64) ;; \
	  *) echo "error: ARCH '$(ARCH)' not supported yet (stub): only amd64 has SrcInsight v.0.0.10 assets (linux-amd64, windows-amd64)" >&2; exit 1;; \
	esac
	case "$(OS)" in \
	  linux|windows) ;; \
	  *) echo "error: OS '$(OS)' not supported: want linux or windows" >&2; exit 1;; \
	esac
	command -v bun >/dev/null || { echo "error: bun not found in PATH" >&2; exit 1; }
	test -f "$(ENTRY)" || { echo "error: entry $(ENTRY) not found" >&2; exit 1; }
	if [ ! -d node_modules ]; then \
	  echo "==> installing deps (bun install)"; \
	  bun install; \
	fi
	mkdir -p "$(OUTDIR)"
	echo "==> bun compile $(ENTRY) -> $(OUTDIR)/$(BINNAME) (OS=$(OS) ARCH=$(ARCH) VERSION=$(VERSION))"
	bun build --compile --define 'process.env.CODRYN_RELEASE_BUILD="1"' --define '__CODRYN_VERSION__="$(VERSION)"' "$(ENTRY)" --outfile "$(OUTDIR)/$(BINNAME)"
	if [ "$(OS)" != "windows" ]; then chmod +x "$(OUTDIR)/$(BINNAME)"; fi
	# The compiled binary cannot see drizzle/ through its $bunfs path, and
	# resolveMigrationsFolder() looks next to the executable. Stage the
	# migrations so the artifact is self-contained for first boot.
	rm -rf "$(OUTDIR)/drizzle"
	cp -r drizzle "$(OUTDIR)/drizzle"
	test -f "$(OUTDIR)/drizzle/meta/_journal.json" || { echo "error: staged migrations incomplete" >&2; exit 1; }
	# The compiled binary cannot see apps/skills/builtin through its $bunfs
	# path, so stage the whole dir (SKILL.md plus future sibling resources).
	rm -rf "$(OUTDIR)/skills"
	mkdir -p "$(OUTDIR)/skills"
	cp -r apps/skills/builtin "$(OUTDIR)/skills/builtin"
	test -n "$$(find "$(OUTDIR)/skills" -name SKILL.md | head -n 1)" || { echo "error: staged builtin skills incomplete (no SKILL.md)" >&2; exit 1; }
	ls -la "$(OUTDIR)"

build-fetch:
	set -eu -o pipefail
	case "$(ARCH)" in \
	  amd64) ;; \
	  *) echo "error: ARCH '$(ARCH)' not supported yet (stub): only amd64 has SrcInsight v.0.0.10 assets (linux-amd64, windows-amd64)" >&2; exit 1;; \
	esac
	case "$(OS)" in \
	  linux|windows) ;; \
	  *) echo "error: OS '$(OS)' not supported: want linux or windows" >&2; exit 1;; \
	esac
	for cmd in curl sha256sum; do command -v "$$cmd" >/dev/null || { echo "error: $$cmd not found in PATH" >&2; exit 1; }; done
	mkdir -p "$(OUTDIR)/insight" "$(OUTDIR)/rg"
	echo "==> fetching SrcInsight v$(INSIGHT_VERSION) for $(OS)-$(ARCH)"
	if [ "$(OS)" = "windows" ]; then \
	  INSIGHT_ASSET="srcinsight-v$(INSIGHT_VERSION)-windows-amd64.exe"; \
	  INSIGHT_SHA256="$(INSIGHT_SHA256_windows)"; \
	else \
	  INSIGHT_ASSET="srcinsight-v$(INSIGHT_VERSION)-linux-amd64"; \
	  INSIGHT_SHA256="$(INSIGHT_SHA256_linux)"; \
	fi
	curl -fL --retry 3 -o "$(OUTDIR)/insight/$$INSIGHT_ASSET" "$(INSIGHT_REPO)/$(INSIGHT_TAG)/$$INSIGHT_ASSET"
	echo "$$INSIGHT_SHA256  $(OUTDIR)/insight/$$INSIGHT_ASSET" | sha256sum -c -
	if [ "$(OS)" != "windows" ]; then chmod +x "$(OUTDIR)/insight/$$INSIGHT_ASSET"; fi
	echo "==> fetching ripgrep $(RG_PREBUILT_TAG) (rg v$(RG_VERSION)) for $(OS)-$(ARCH) (microsoft/ripgrep-prebuilt)"
	test -n "$(RG_VERSION)" || { echo "error: cannot derive RG_VERSION from RG_PREBUILT_TAG '$(RG_PREBUILT_TAG)' (want v<semver>-<rev>)" >&2; exit 1; }
	TMPDIR="$$(mktemp -d)"; trap 'rm -rf "$$TMPDIR"' EXIT
	if [ "$(OS)" = "windows" ]; then \
	  command -v unzip >/dev/null || { echo "error: unzip not found in PATH" >&2; exit 1; }; \
	  RG_TRIPLE="$(RG_TRIPLE_windows)"; \
	  RG_ASSET="ripgrep-$(RG_PREBUILT_TAG)-$$RG_TRIPLE.zip"; \
	  RG_SHA256="$(RG_SHA256_windows)"; \
	  RG_OUT="rg-v$(RG_VERSION)-$$RG_TRIPLE.exe"; \
	else \
	  command -v tar >/dev/null || { echo "error: tar not found in PATH" >&2; exit 1; }; \
	  RG_TRIPLE="$(RG_TRIPLE_linux)"; \
	  RG_ASSET="ripgrep-$(RG_PREBUILT_TAG)-$$RG_TRIPLE.tar.gz"; \
	  RG_SHA256="$(RG_SHA256_linux)"; \
	  RG_OUT="rg-v$(RG_VERSION)-$$RG_TRIPLE"; \
	fi
	curl -fL --retry 3 -o "$$TMPDIR/$$RG_ASSET" "$(RG_REPO)/$(RG_PREBUILT_TAG)/$$RG_ASSET"
	echo "$$RG_SHA256  $$TMPDIR/$$RG_ASSET" | sha256sum -c -
	rm -f "$(OUTDIR)"/rg/rg "$(OUTDIR)"/rg/rg.exe "$(OUTDIR)"/rg/rg-v*
	if [ "$(OS)" = "windows" ]; then \
	  unzip -o -q "$$TMPDIR/$$RG_ASSET" -d "$$TMPDIR/rg"; \
	  RG_BIN="$$(find "$$TMPDIR/rg" -name 'rg.exe' -type f | head -n 1)"; \
	  test -n "$$RG_BIN" || { echo "error: rg.exe not found inside $$RG_ASSET" >&2; exit 1; }; \
	  cp "$$RG_BIN" "$(OUTDIR)/rg/$$RG_OUT"; \
	else \
	  tar -xzf "$$TMPDIR/$$RG_ASSET" -C "$$TMPDIR"; \
	  RG_BIN="$$(find "$$TMPDIR" -name rg -type f | head -n 1)"; \
	  test -n "$$RG_BIN" || { echo "error: rg binary not found inside $$RG_ASSET" >&2; exit 1; }; \
	  cp "$$RG_BIN" "$(OUTDIR)/rg/$$RG_OUT"; \
	  chmod +x "$(OUTDIR)/rg/$$RG_OUT"; \
	fi
	"$(OUTDIR)/rg/$$RG_OUT" --version 2>&1 | grep -Eq 'ripgrep $(RG_VERSION)' || { echo "error: fetched rg did not report ripgrep $(RG_VERSION)" >&2; exit 1; }
	trap - EXIT; rm -rf "$$TMPDIR"
	ls -la "$(OUTDIR)/insight" "$(OUTDIR)/rg"

build-test:
	set -eu -o pipefail
	case "$(ARCH)" in \
	  amd64) ;; \
	  *) echo "error: ARCH '$(ARCH)' not supported yet (stub): only amd64 is tested" >&2; exit 1;; \
	esac
	test -d "$(OUTDIR)" || { echo "error: $(OUTDIR) not found; run make build-backend and make build-fetch first" >&2; exit 1; }
	echo "==> stage A: typecheck + unit tests"
	npm run typecheck
	npm test
	echo "==> stage B: E2E against compiled binary"
	bash scripts/e2e-backend.sh "$(OUTDIR)"

help:
	echo "usage:"
	echo "  make build-backend OS=linux|windows ARCH=amd64 VERSION=<ver>"
	echo "  make build-fetch   OS=linux|windows ARCH=amd64 VERSION=<ver> [RG_PREBUILT_TAG=<tag> RG_SHA256_linux=<sha> RG_SHA256_windows=<sha>]"
	echo "  make build-test    OS=linux|windows ARCH=amd64 VERSION=<ver>"
	echo "output: dist/build-<version>-<os>-<arch>/{codryn[.exe],insight/,rg/}"
	echo "rg output: rg/rg-v<semver>-<triple>[.exe] (RG_VERSION derived from RG_PREBUILT_TAG)"
