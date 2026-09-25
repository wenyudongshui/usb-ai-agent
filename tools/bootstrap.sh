#!/bin/bash
# tools/bootstrap.sh — POSIX twin of bootstrap.ps1.
# Locates / downloads a pinned portable Node.js into engine/, then runs
# tools/launcher.mjs. Downloads + SHA256 verification only on first run.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="24.21.0"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS" in
  linux) PLAT="linux" ;;
  darwin) PLAT="darwin" ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

NODE_DIR="$ROOT/engine/node-$PLAT-$ARCH"
NODE_EXE="$NODE_DIR/bin/node"

NODE_READY=""
if [ -x "$NODE_EXE" ]; then
  CURRENT="$("$NODE_EXE" --version 2>/dev/null || echo '')"
  [ "$CURRENT" = "v$VERSION" ] && NODE_READY="1"
fi

if [ -z "$NODE_READY" ]; then
  TARBALL="node-v$VERSION-$PLAT-$ARCH.tar.xz"
  BASE="https://nodejs.org/dist/v$VERSION"
  mkdir -p "$ROOT/engine"
  echo "Downloading portable Node.js v$VERSION ..."
  curl -fL "$BASE/$TARBALL" -o "$ROOT/engine/$TARBALL"
  echo "Verifying checksum ..."
  EXPECTED="$(curl -fsL "$BASE/SHASUMS256.txt" | awk -v f="$TARBALL" '$2==f {print $1}')"
  ACTUAL="$(sha256sum "$ROOT/engine/$TARBALL" | awk '{print $1}')"
  if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    rm -f "$ROOT/engine/$TARBALL"
    echo "Node.js checksum verification failed - please run start.sh again."
    exit 1
  fi
  EXTRACTED="$ROOT/engine/node-v$VERSION-$PLAT-$ARCH"
  rm -rf "$EXTRACTED"
  tar -xf "$ROOT/engine/$TARBALL" -C "$ROOT/engine"
  rm -f "$ROOT/engine/$TARBALL"
  if [ -d "$NODE_DIR" ]; then mv "$NODE_DIR" "$NODE_DIR.previous.$(date +%s)"; fi
  mv "$EXTRACTED" "$NODE_DIR"
  echo "Portable Node.js v$VERSION ready."
fi

export PATH="$NODE_DIR/bin:$PATH"
exec "$NODE_EXE" "$ROOT/tools/launcher.mjs" "$@"