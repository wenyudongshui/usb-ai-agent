#!/bin/bash
# tools/setup_local_models.sh — POSIX twin of setup_local_models.ps1.
# Downloads a portable Ollama engine into data/ollama and pulls selected
# local models. Portable + offline-capable, matching the upstream base.
set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${PORTABLE_AI_DATA_DIR:-$ROOT_DIR/data}"
MODELS_DIR="$DATA_DIR/models"
OLLAMA_DIR="$DATA_DIR/ollama"

CATALOG=(
  "1|Gemma 4 E2B (Q4_K_M)|https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf|Text|3.1"
  "2|Gemma 4 E2B (Q6_K)|https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q6_K.gguf|Text|4.5"
  "3|Gemma 4 E4B (Q4_K_M)|https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf|Text|5.0"
  "4|Qwen 3.5 (9B)|qwen3.5:9b|Text, Image|6.6"
  "5|Ministral 3 (8B)|ministral-3:8b|Text, Image|6.0"
)

PLAT="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$PLAT:$ARCH" in
  linux:x86_64|linux:amd64) OLLAMA_URL="https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst"; OLLAMA_BIN="bin/ollama" ;;
  linux:arm64|linux:aarch64) OLLAMA_URL="https://github.com/ollama/ollama/releases/latest/download/ollama-linux-arm64.tar.zst"; OLLAMA_BIN="bin/ollama" ;;
  darwin:*) OLLAMA_URL="https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz"; OLLAMA_BIN="ollama" ;;
  *) echo "Unsupported OS/arch: $PLAT/$ARCH (use the .ps1 on Windows)"; exit 1 ;;
esac

echo ""
echo "=========================================================="
echo "   USB AI AGENT - Local Model Setup (Ollama, portable)"
echo "=========================================================="
echo ""
echo "[1/4] Choose your AI model(s):"
for line in "${CATALOG[@]}"; do
  IFS='|' read -r NUM NAME TAG INPUT SIZE <<< "$line"
  echo "  [$NUM] $NAME [${INPUT}] (~${SIZE} GB)"
done
echo "  [C] CUSTOM - Enter an Official Ollama Tag"
echo "      Browse ALL models here: https://ollama.com/library"
echo ""
printf "  Your choice (e.g. 1,4): "
read -r USER_CHOICE
[ -z "$USER_CHOICE" ] && USER_CHOICE="3"

SELECTED=()
HAS_CUSTOM=0
IFS=',' read -ra TOKENS <<< "$USER_CHOICE"
for T in "${TOKENS[@]}"; do
  T=$(echo "$T" | tr '[:upper:]' '[:lower:]' | tr -d ' \r\n')
  case "$T" in
    c|custom) HAS_CUSTOM=1 ;;
    *) for line in "${CATALOG[@]}"; do
         IFS='|' read -r NUM NAME TAG INPUT SIZE <<< "$line"
         [ "$T" = "$NUM" ] && SELECTED+=("$TAG|$NAME|$TAG") && break
       done ;;
  esac
done
if [ "$HAS_CUSTOM" -eq 1 ]; then
  printf "  Custom Ollama Tag (e.g. mistral-nemo, phi3): "
  read -r CUSTOM_TAG
  [ -n "$CUSTOM_TAG" ] && SELECTED+=("$CUSTOM_TAG|Custom: $CUSTOM_TAG|$CUSTOM_TAG")
fi
if [ "${#SELECTED[@]}" -eq 0 ]; then echo "ERROR: No models selected!"; exit 1; fi

mkdir -p "$MODELS_DIR" "$OLLAMA_DIR/data"
echo ""
echo "[2/4] Created storage folders."

OLLAMA_EXE="$OLLAMA_DIR/ollama"
echo ""
echo "[3/4] Setting up Portable Ollama Engine..."
if [ -x "$OLLAMA_EXE" ]; then
  echo "      Engine already installed!"
else
  echo "      Downloading Ollama Engine..."
  curl -fL "$OLLAMA_URL" -o "$OLLAMA_DIR/ollama.$PLAT.tar"
  tar -xf "$OLLAMA_DIR/ollama.$PLAT.tar" -C "$OLLAMA_DIR" 2>/dev/null
  rm -f "$OLLAMA_DIR/ollama.$PLAT.tar"
  if [ -f "$OLLAMA_DIR/$OLLAMA_BIN" ]; then mv "$OLLAMA_DIR/$OLLAMA_BIN" "$OLLAMA_EXE"; rm -rf "$OLLAMA_DIR/bin"; fi
  chmod +x "$OLLAMA_EXE"
  echo "      Engine Installed successfully!"
fi

echo ""
echo "[4/4] Pulling Models (local, offline-capable)..."
export OLLAMA_MODELS="$OLLAMA_DIR/data"
"$OLLAMA_EXE" serve >/dev/null 2>&1 &
SERVER_PID=$!
sleep 5

idx=1
for entry in "${SELECTED[@]}"; do
  IFS='|' read -r TAG NAME ORIG <<< "$entry"
  echo "  ($idx/${#SELECTED[@]}) Pulling $NAME [$TAG]..."
  idx=$((idx+1))
  if "$OLLAMA_EXE" show "$TAG" >/dev/null 2>&1; then
    echo "      Already pulled - skipping!"
  elif "$OLLAMA_EXE" pull "$TAG"; then
    echo "      Pull complete!"
  else
    echo "      FAILED to pull model: $TAG"
  fi
done
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true

for entry in "${SELECTED[@]}"; do
  IFS='|' read -r TAG NAME ORIG <<< "$entry"
  echo "$ORIG|$NAME|LOCAL"
done >> "$MODELS_DIR/installed-models.txt"
sort -u "$MODELS_DIR/installed-models.txt" -o "$MODELS_DIR/installed-models.txt" 2>/dev/null || true

echo ""
echo "=========================================================="
echo "   SETUP COMPLETE! LOCAL AI AGENTS ARE READY!"
echo "=========================================================="
echo ""
echo "  Next step (in the web UI):"
echo "   1. Run start.sh and log in"
echo "   2. 'Add AI': API base http://127.0.0.1:11434/v1"
echo "      model: ${SELECTED[0]%%|*}   key: ollama (any)"
echo "   3. Start local Ollama in the System page, then chat"
echo ""