#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_WORKTREE="${PR56_MAIN_WORKTREE:-/tmp/backchat-main-pr56-item-02}"
PRE_WORKTREE="${PR56_PRE_WORKTREE:-/tmp/backchat-pre-item02-cbe629a}"
ITEM_ROOT="${PR56_ITEM_02_ROOT:-/opt/cursor/artifacts/pr56-item-02}"
SPEC="$ROOT/e2e/capture-pr56-item-02-evidence.spec.ts"
PRE_REF="${PR56_ITEM_02_PRE_REF:-cbe629a^}"

mkdir -p "$ITEM_ROOT"

ensure_worktree() {
  local path="$1"
  local ref="$2"
  if [[ ! -e "$path/.git" ]] && [[ ! -f "$path/.git" ]]; then
    git -C "$ROOT" worktree add "$path" "$ref"
  fi
}

build_app() {
  local dir="$1"
  echo "Building $dir …"
  (cd "$dir" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
  (cd "$dir" && pnpm exec electron-vite build)
}

run_capture() {
  local phase="$1"
  local app_root="$2"
  local suite="$3"
  local host_baseline="$4"
  local out_root="$5"
  echo "Capture phase=$phase suite=$suite host_baseline=$host_baseline app_root=$app_root"
  PR56_ITEM_02_PHASE="$phase" \
  PR56_ITEM_02_ROOT="$out_root" \
  PR56_ITEM_02_SUITE="$suite" \
  PR56_ITEM_02_HOST_BASELINE="$host_baseline" \
  BACKCHAT_E2E_APP_ROOT="$app_root" \
  "$ROOT/node_modules/.bin/playwright" test "$SPEC"
}

ensure_worktree "$MAIN_WORKTREE" "origin/main"
ensure_worktree "$PRE_WORKTREE" "$PRE_REF"

build_app "$ROOT"
build_app "$MAIN_WORKTREE"
build_app "$PRE_WORKTREE"

MAIN_ROOT="$ITEM_ROOT/main-regression"
run_capture before "$MAIN_WORKTREE" full main "$MAIN_ROOT"
run_capture after "$ROOT" full main "$MAIN_ROOT"
PR56_ITEM_02_ROOT="$MAIN_ROOT" PR56_COMPARE_LEFT_LABEL="main" PR56_COMPARE_RIGHT_LABEL="PR head" \
  node "$ROOT/scripts/stitch-pr56-before-after.mjs"

PRE_ROOT="$ITEM_ROOT/host-height-fix"
run_capture before "$PRE_WORKTREE" host-only pre "$PRE_ROOT"
run_capture after "$ROOT" host-only pre "$PRE_ROOT"
PR56_ITEM_02_ROOT="$PRE_ROOT" \
  PR56_COMPARE_LEFT_LABEL="修复前 (cbe629a^)" \
  PR56_COMPARE_RIGHT_LABEL="PR head" \
  node "$ROOT/scripts/stitch-pr56-before-after.mjs"

mkdir -p "$ITEM_ROOT/compare"
cp -f "$MAIN_ROOT/compare"/*-compare.png "$ITEM_ROOT/compare/" 2>/dev/null || true
cp -f "$PRE_ROOT/compare"/host-*-compare.png "$ITEM_ROOT/compare/" 2>/dev/null || true

echo "Done. Compare PNGs: $ITEM_ROOT/compare"
