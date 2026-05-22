#!/usr/bin/env bash
#
# Package the extension into a ZIP for Chrome Web Store submission.
#
# Produces dist/agentic-browser-chat-<version>.zip containing only the files
# the extension needs at runtime. Repo metadata, docs, and dev files are
# excluded.
#
# Usage:
#   bash scripts/package.sh
#
set -euo pipefail

# Resolve repo root (parent of this script's directory) regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -f manifest.json ]]; then
  echo "error: manifest.json not found in ${ROOT_DIR}" >&2
  exit 1
fi

# Read version from manifest.json (no jq dependency).
VERSION="$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
if [[ -z "${VERSION}" ]]; then
  echo "error: could not read version from manifest.json" >&2
  exit 1
fi

OUT_DIR="dist"
OUT_FILE="${OUT_DIR}/agentic-browser-chat-${VERSION}.zip"

mkdir -p "${OUT_DIR}"
rm -f "${OUT_FILE}"

# Runtime files/dirs to include. Anything not listed here is left out.
INCLUDE=(
  manifest.json
  icon.png
  styles.css
  agent
  background
  content
  lib
  offscreen
  panel
  shared
  sounds
  tools
  ui
  utils
)

# Verify each include path exists before zipping.
for path in "${INCLUDE[@]}"; do
  if [[ ! -e "${path}" ]]; then
    echo "error: expected path missing: ${path}" >&2
    exit 1
  fi
done

# Zip, excluding OS noise that may live inside included directories.
zip -r -X "${OUT_FILE}" "${INCLUDE[@]}" \
  -x "*.DS_Store" \
  -x "*/.DS_Store"

echo ""
echo "Created ${OUT_FILE}"
echo "Upload this file in the Chrome Web Store Developer Dashboard."
