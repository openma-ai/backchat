# Common UI source bridge

The source of this change is `/Users/minimax/oos-proj/openma/.worktrees/common-ui-quality`, based on common commit `d00d876c41a3e244c5f14f7d7ff145d957df7a7f` (the version already pinned by Backchat).

The active `patches/@openma__common-ui@0.4.0.patch` is generated with `git diff --binary -- dist` after `pnpm run verify` in that worktree. It includes compiled JavaScript, declarations, and source maps. It is a reproducible bridge until the common source changes are reviewed and released; do not edit the patch instead of the source. The older similarly named `@openma__common@0.4.0.patch` was inactive and was removed when Backchat moved to `@openma/common` v0.7.2.

After a source change: verify and build common, regenerate the active patch, run `pnpm install --ignore-scripts --no-frozen-lockfile` in Backchat to update its patch checksum, then run consumer types/build and focused streaming/chat tests. A real common release must additionally follow common's two-consumer release checklist. No release was made in this audit.
