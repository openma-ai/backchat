# Releasing Backchat

Backchat releases are tagged from `main`. A `vX.Y.Z` tag must match
`package.json#version`; the tag workflow builds the macOS DMG and publishes a
GitHub Release after its packaged runtime, signature, and first-prompt checks.

## Before merging

1. Pin Git dependencies in `package.json` and `pnpm-workspace.yaml`, regenerate
   `pnpm-lock.yaml`, and verify a frozen install. OpenMatter is currently consumed
   through one immutable Git commit for every package subdirectory. The shared
   `@openma/common` dependency uses an immutable release tag.
2. Run `pnpm typecheck`, `pnpm test:ci`,
   `node --test scripts/*.test.mjs`, `pnpm build`, and `pnpm test:e2e:fast`.
3. For Pi coordinator changes, run the opt-in real adapter test described in
   [project-coordinator-pi.md](testing/project-coordinator-pi.md) with an
   isolated Pi configuration and the intended adapter version.
4. Run `pnpm package:dir` and the packaged runtime verification scripts on the
   built app. Check the GitHub Actions result for the release candidate.

## Publish

Merge the release change to `main`, then create and push a new, immutable
`vX.Y.Z` tag at that commit. The tag workflow publishes the versioned DMG and
`Backchat-arm64.dmg` after all checks pass. Confirm the workflow and both
release assets on GitHub before announcing the version. Never retarget an
existing tag.
