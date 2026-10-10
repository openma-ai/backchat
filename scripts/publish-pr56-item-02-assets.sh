#!/usr/bin/env bash
# Push PR56 item-02 compare PNGs to orphan branch pr-assets (see CONTRIBUTING.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPARE_DIR="${PR56_ITEM_02_COMPARE_DIR:-/opt/cursor/artifacts/pr56-item-02/main-regression/compare}"
ASSET_DIR="pr-56"
WORK="/tmp/backchat-pr-assets-$$"
REPO="${GITHUB_REPO:-openma-ai/backchat}"

if [[ ! -d "$COMPARE_DIR" ]]; then
  echo "Missing compare dir: $COMPARE_DIR" >&2
  exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK"
git init -q
git remote add origin "https://github.com/${REPO}.git"

if git fetch origin pr-assets:pr-assets 2>/dev/null; then
  git checkout pr-assets
  git rm -rf . 2>/dev/null || true
else
  git checkout --orphan pr-assets
fi

mkdir -p "$ASSET_DIR"
cp -f "$COMPARE_DIR"/host-many-en-compare.png "$ASSET_DIR/"
cp -f "$COMPARE_DIR"/usage-project-picker-compare.png "$ASSET_DIR/"

git add "$ASSET_DIR"
git commit -m "pr-assets: pr-56 item 02 evidence ($(date -u +%Y-%m-%dT%H:%MZ))"
git push -u origin pr-assets

BASE="https://raw.githubusercontent.com/${REPO}/pr-assets/${ASSET_DIR}"
echo "HOST_MANY_URL=${BASE}/host-many-en-compare.png"
echo "PROJECT_PICKER_URL=${BASE}/usage-project-picker-compare.png"
