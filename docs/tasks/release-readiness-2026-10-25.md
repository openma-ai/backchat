# Release readiness — 2026-10-25

User accepted candidate visual/interaction fixes; release prep started.
Current package remains 0.0.18. Next patch candidate: 0.0.19, not tagged/pushed.

## Included candidate scope
- Composer selectors and steering consistency, local session status feedback.
- Collapse geometry, stable message DOM, history reading anchors.
- Native traffic-light rail sync across zoom; stronger navigation ink.
- Compact sent/composer images with full-size viewer.
- 20-minute capability-gated idle process release without archival.
- Process-header thinking ownership and live shimmer.
- Long transcript jump navigation through shared virtualizer bridge.

## Gates
- Main/web TypeScript checks pass.
- Curated CI 848 cases and script suite63 pass (pre-navigation snapshot).
- Navigation + thinking Electron2/2 pass on final build.
- Prior visual native zoom/ink/image Electron3/3 pass.
- Candidate package must match out/ byte-for-byte and pass isolated runtime.

## Explicit exclusions / unresolved work
- Structured retry rendering inside transcript remains unfinished; draft test
  preserved as docs/tasks/deferred-tests/turn-retry-state.test.ts.txt, not a
  release test or implemented feature. No string-based retry classification.
- Native adapter goal fix is in sibling adapter checkout, not automatically
  distributed by packaging Backchat. Do not claim it shipped without pinning.
- Exit warning still considers idle connected processes/runner; idle reclamation
  reduces retained connections but does not replace shutdown-impact policy.
- Full non-curated suite has known baseline failures; do not claim all-green.
- Local candidate uses adhoc signing, not a notarized public distribution.
- Do not include .pnpm-store, local screenshots/binaries, absolute-path link
  receipts or unfinished diagnostics in a public source commit accidentally.

## Publishing
Official signed/notarized distribution is built by build-dmg workflow on tag.
Before tag: settle above exclusions in release notes, choose/version patch,
review staged diff and source-owned common patch, then CI and release assets.
No remote release created during this preparation pass.

### User acceptance — 2026-10-25
User replied “👌” after the packaged thinking-shimmer and virtual message-navigation fixes. Mark these two candidate fixes accepted for the upcoming release scope. Public release/tag remains pending; acceptance does not imply unresolved exclusions are fixed.

### Sequential release request
User explicitly requested common first, then Backchat dependency update/release.
Common release/v0.11.1 commit b27befd pushed. 861 tests, typecheck, dist freshness
and release-check pass. GitHub API TLS timeouts currently prevent creating PR;
no tag pushed, npm remains 0.11.0. Backchat curated suite 857 passed unsandboxed,
script suite passes. Release notes prepared; Backchat version/dependency not yet
changed pending successful common publication. Never bypass failed gates.

### common publication complete
Common PR #53 merged as 73c30fe, tag v0.11.1 pushed; npm confirmed 0.11.1.
Backchat preparing 0.0.19 with all common consumers pinned 0.11.1 and no patch.
Curated suite now includes compact regressions: 922 passed, script tests passed,
5 critical Electron regressions passed before formal dependency refresh.
