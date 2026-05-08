#!/usr/bin/env bash
set -euo pipefail

# Download default Piper voice models for transferencia.
# Voices land in build/.piper-voices/

DEST="$(cd "$(dirname "$0")/.." && pwd)/.piper-voices"
mkdir -p "$DEST"

declare -a VOICES=(
  "es_MX/claude/high/es_MX-claude-high.onnx|https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx"
  "es_MX/claude/high/es_MX-claude-high.onnx.json|https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx.json"
  "en_US/amy/medium/en_US-amy-medium.onnx|https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx"
  "en_US/amy/medium/en_US-amy-medium.onnx.json|https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json"
)

for entry in "${VOICES[@]}"; do
  rel="${entry%%|*}"
  url="${entry#*|}"
  out="$DEST/$rel"
  mkdir -p "$(dirname "$out")"
  if [[ -f "$out" ]]; then
    echo "skip  $rel (exists)"
    continue
  fi
  echo "fetch $rel"
  curl -fsSL "$url" -o "$out"
done

echo "Voices in $DEST"
ls "$DEST"
