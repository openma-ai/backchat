# AUTHORITATIVE STEERING (read immediately; supersedes softer wording)

## Zero behavior changes (HARD)
不准破坏任何业务逻辑. ZERO product/behavior/semantics changes.
Perf-only allowed: memo, batching/coalescing that preserves event order & content,
already-safe virtualization/windowing, async IPC (no sync), lazy load of non-critical
UI, SQLite indexes that do not change query results, selector granularity, stable
references, avoid unnecessary re-renders.
If a change risks behavior/tests, DISCARD it. Keep existing tests green.

## Metric targets (HARD) — each ~50%
Improve ALL THREE under the SAME envelopes before vs after:
1. **SPEED / latency** — wall time of hot paths lower by ~50% (higher speed).
2. **CPU** — CPU time / main-thread busy / process CPU% lower by ~50% for same work.
3. **MEMORY** — heap/RSS (or allocated retained after GC where measurable) lower by ~50% for same load; no sustained growth under multi-session soak.

Report before/after tables for CPU + MEMORY + SPEED for:
- microbench (SessionStore vitest / performance.now envelopes)
- high-load long transcript (+ scroll/FPS proxies)
- many parallel sessions (create/switch/keep-alive + concurrent update bursts)

Do not fake numbers. If 50% not reached on a dimension, ship honest best with evidence.

## Harness
Continue using e2e/long-transcript-performance, e2e/interaction-performance,
docs/audits/*performance*.json, session-store performance invariants.
Engine remains astra high externally; do not rename models.

## Metric instrumentation checklist (append 05:07 America/Detroit)
SPEED: wall ms already in store stress + e2e history/scroll/burst — keep.
MEMORY: process.memoryUsage() in store rounds + app.getAppMetrics() in e2e — keep; also report heapUsed delta after GC if feasible (`global.gc` with --expose-gc) so growth is attributable.
CPU: ADD explicit CPU samples — e.g. `process.cpuUsage()` deltas around setup/streaming/switch batches in vitest; e2e already has PerformanceObserver longtasks — report sum/count of longTasks as CPU proxy. Do not use wall-only as the sole CPU claim.
PR description must have a 3-row (CPU/MEMORY/SPEED) × scenarios table with before→after and % change. Discard any edit that changes ACP/session semantics or fails existing unit tests.

## PRIMARY reminder (05:14 America/Detroit)
Perf track is PRIMARY. SessionTurnMap may already be wired into SessionStore#turns /
#ownTurnsFor — verify, do not revert. Next: after-metrics (same envelopes), more
safe hotpath opts (session-scoped scans, selector stability, avoid retained growth).
Ship PR with CPU/MEMORY/SPEED before→after table. UX above is bundled secondary only.
