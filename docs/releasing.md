# Releasing Backchat

Backchat builds test packages in GitHub Actions. Publishing a public preview or
stable release requires a separate, manual workflow dispatch. Pushing a branch,
merging to `main`, or pushing a version tag must not publish a public release asset.

## 1. Review the development build

Implement the change locally and run the relevant type checks and tests. Start
`pnpm dev` and show the changed UI to the maintainer. Do not push the branch
until the maintainer has reviewed that UI and asked to proceed. Do not build a
DMG locally.

For dependency changes, pin Git dependencies in `package.json` and
`pnpm-workspace.yaml`, regenerate `pnpm-lock.yaml`, and verify a frozen install.
OpenMatter is consumed through one immutable Git commit for every package
subdirectory. The shared `@openma/common` dependency uses an immutable release
tag. For Pi coordinator changes, also run the opt-in real adapter test in
[project-coordinator-pi.md](testing/project-coordinator-pi.md) with isolated
configuration.

## 2. Build and review the CI test package

After the maintainer approves the development build, push the branch and run
**Build macOS DMG** on that branch with `publish_channel=none`. The workflow
checks types and tests, builds the DMG, verifies packaged runtime imports and
the macOS signature, exercises the first prompt, and uploads the DMG as a
workflow artifact. Download that artifact from the Actions run so the
maintainer can install and verify the exact candidate package. This artifact
is the beta package for that branch. A passing CI result alone does not
authorize a merge or release.

## 3. Publish after package approval

Only after the maintainer approves the CI-built package, merge the release
change to `main`. Create a new, immutable `vX.Y.Z` tag at the merge commit;
the tag must match `package.json#version`. Tag pushes do not publish releases.
Manually run **Build macOS DMG** on the tag with `publish_channel=stable` to
publish the versioned DMG and `Backchat-arm64.dmg`. Check the workflow and both
assets on GitHub before announcing the version. Never retarget an existing tag.

The existing `preview` prerelease can be updated only by manually running
**Build macOS DMG** on `main` with `publish_channel=preview`. Ordinary `main`
pushes only upload a CI artifact; they no longer overwrite the public preview.
