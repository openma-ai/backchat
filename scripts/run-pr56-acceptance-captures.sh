#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_WORKTREE="${PR56_MAIN_WORKTREE:-/tmp/backchat-main-pr56-acceptance}"
ACCEPT_ROOT="${PR56_ACCEPTANCE_ROOT:-/opt/cursor/artifacts/pr56-acceptance}"

mkdir -p "$ACCEPT_ROOT"

if [[ ! -e "$MAIN_WORKTREE/.git" ]] && [[ ! -f "$MAIN_WORKTREE/.git" ]]; then
  git -C "$ROOT" worktree add "$MAIN_WORKTREE" origin/main
fi

echo "Building main (before)…"
(cd "$MAIN_WORKTREE" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
(cd "$MAIN_WORKTREE" && pnpm exec electron-vite build)

echo "Building PR (after)…"
(cd "$ROOT" && pnpm exec electron-vite build)

run_phase() {
  local phase="$1"
  local app_root="$2"
  echo "Capturing phase=$phase app_root=$app_root"
  PR56_ACCEPTANCE_PHASE="$phase" \
  PR56_ACCEPTANCE_ROOT="$ACCEPT_ROOT" \
  BACKCHAT_E2E_APP_ROOT="$app_root" \
  "$ROOT/node_modules/.bin/playwright" test \
    "$ROOT/e2e/capture-pr56-evidence.spec.ts"
}

run_phase before "$MAIN_WORKTREE"
run_phase after "$ROOT"

node "$ROOT/scripts/stitch-pr56-before-after.mjs"
echo "Done. Artifacts: $ACCEPT_ROOT"
