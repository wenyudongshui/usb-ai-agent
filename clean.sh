#!/bin/bash
# clean.sh — POSIX twin of clean.bat: delete host residue recorded in data/keys/cache_path.txt.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
CFGPATH="${PORTABLE_AI_DATA_DIR:-$ROOT/data}/keys/cache_path.txt"

if [ ! -f "$CFGPATH" ]; then
    echo "[INFO] No cache_path.txt found - nothing to clean."
    exit 0
fi

echo "Cleaning recorded cache paths from $CFGPATH ..."
while IFS= read -r P; do
    [ -z "$P" ] && continue
    if [ -d "$P" ]; then
        rm -rf "$P" && echo "[OK] Deleted: $P" || echo "[WARN] Could not delete: $P"
    else
        echo "[SKIP] Not found (already gone): $P"
    fi
done < "$CFGPATH"
: > "$CFGPATH"
echo "[DONE] Residue cleanup finished."