# Task environment view

`taskEnvironment(request)` is the desktop read-only boundary for both local and
remote tasks. `TaskEnvironment` in `src/shared/task-environment.ts` contains an
environment ID and a list of checkouts. The resource panel renders those
checkouts through one component and one query lifecycle.

- Local tasks: query the selected workspace's checkout paths with Git and gh/glab.
- Backchat-hosted runner tasks: resolve only the existing scoped runner session
  binding, then use the same reader. Viewing a task never creates a binding.
- Other remote tasks: retrieve Session resources using that task's account and
  workspace credentials. Map repository URL, mount path and configured checkout.
  The current service interface has no live checkout inspection RPC; these
  sessions explicitly report live fields as unknown. Never run local commands
  against paths received in remote Session resources.

`configuredRevision` describes the requested checkout. `branch` and `headSha`
are observations of the current checkout, and must not be inferred from it.
`changes: null` means unknown, not a clean working tree. `reviews: null` means
unobserved; an empty array means discovery found no reviews (including the
existing best-effort CLI unavailable/unauthorized behavior). `observedAt` is
set only by the live reader. Repository URLs omit embedded credentials.

Queries refresh when the panel mounts, when a running turn finishes, and every
30 seconds while visible. Query caching/deduplication is in memory. No Git or
PR/MR snapshot is added to SQLite; existing manual links remain separate.
Errors do not change task lifecycle or submit agent input. Future remote
runner inspection can fill this same contract without a second renderer.
