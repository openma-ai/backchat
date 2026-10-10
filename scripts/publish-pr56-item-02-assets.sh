#!/usr/bin/env bash
# Deprecated: do not push evidence to git or pr-assets.
# Use /opt/cursor/artifacts only; post PR comments with:
#   node scripts/publish-pr56-item-inline.mjs pr56-item-02
# then ManagePullRequest post_comment with the printed <img src="/opt/cursor/artifacts/..."/> tags.
set -euo pipefail
echo "publish-pr56-item-02-assets.sh is deprecated (no git/pr-assets evidence)." >&2
echo "See scripts/publish-pr56-item-inline.mjs and /opt/cursor/artifacts/pr56-item-02/compare/" >&2
exit 1
