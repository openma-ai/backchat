# OpenMA desktop integration: reproducible push verification

Verified on macOS with Node 24.18.0 and pnpm 11.24.0, 2026-09-16.

## Dependency and source boundaries

- `@openma/common` is pinned to upstream commit
  `82ce654e3f46eb9fdbebedb2b96bd8f7e0d76817`. Its source and rebuilt distribution
  were tested in an isolated checkout: 242 tests, typecheck and build.
- The desktop was installed in a new worktree from the remote shared-library
  tarball. `pnpm install --frozen-lockfile`, typecheck and production build pass.
  Neither dependency manifests nor Vitest aliases require a sibling checkout.
- Node 24 and pnpm 11.24.0 are recorded in the package and CI setup. Built-only
  Google GenAI and protobufjs packages explicitly skip their no-op/version-warning
  installation hooks. Existing native build permissions remain explicit.
- SDK source remains the documented upstream snapshot. Daemon connection source
  matches the service-side `af45e233` snapshot byte for byte.
- Service/CLI integration was prepared on current `origin/main` in an isolated
  worktree. Original checkout changes, including unrelated assets and shared UI
  work, were left in place. These pushes do not deploy or merge either product.

## Validation

- Desktop curated CI: 51 suites / 364 tests.
- Additional changed desktop/runtime/storage/UI suites: 9 suites / 86 tests.
- Node release/script tests: 27 tests.
- Electron: 15 storage scenarios plus 61 smoke/composer/export/OpenMA scenarios
  were exercised. Initial failures were corrected and verified with focused
  reruns: persisted drafts, Cursor replay, sidebar icon alignment, activity
  summary alignment and composer rail alignment.
- The four OpenMA scenarios cover account/owned runner/project routing,
  cloud restart and continuation, external daemon ownership, and simultaneous
  tenant groups with owner-scoped creation and continuation.
- Service-side validation: runtime 42 tests, CLI 19, service integration/unit 26,
  relay 4, root/CLI typechecks, CLI build and built CLI help smoke test.

Electron test homes now isolate Chromium user data as well as application data,
so old developer drafts cannot contaminate tests. Activity alignment assertions
compare primary summaries and icon centers, preserving nested detail indentation
and avoiding rotating-spinner bounding-box edges.

The CI Electron job also runs `pnpm test:e2e:openma`. Local verification uses
loopback service fixtures; it does not certify a deployed service or all OSes.
Publishing a local session's existing history into a tenant remains separate
follow-on scope, as documented in the architecture decision.
