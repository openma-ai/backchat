# Backchat high-load performance evidence — 2026-11-05

The validated change indexes canonical turns by session and caches each session's registration-order array. It removes global transcript scans from session-local reads, history checks, deletion, and reconciliation. All writes still pass through the canonical Map boundary. Turn values, ordering, stream publication, ACP event boundaries, and the main-process projection architecture are preserved.

Under the 101-session / 23,100-turn store workload, streaming wall time drops 71.4%, switching CPU 95.3%, and structural-update CPU 96.0%. Electron remains dominated by layout, focus, and Markdown work. **The 50% target is met for selected store latency/CPU paths, not whole-app latency or memory.** Retained store heap increases about 1 MiB.

## Results

Values are before → after. Parentheses indicate reduction; negative reduction means worse. CPU uses actual process CPU deltas, not wall time. Memory columns are checkpoints, not memory attributable solely to the named operation.

| Dimension | Store stress: 101 sessions / 23,100 turns | Electron: 500-turn history and scrolling | Electron: 24 sessions / concurrent bursts |
|---|---|---|---|
| SPEED | 20k chunks 215.114 → 61.623 ms (71.4%); switch median 1.594 → 0.025 ms (98.4%) | History ready 315.5 → 326.2 ms (−3.4%); double-rAF median 51.55 → 52.20 ms (−1.3%); p95 63.7 → 72.9 ms (−14.4%) | Warm switch median 96.75 → 98.20 ms (−1.5%); burst total 3,083.76 → 2,957.75 ms (4.1%) |
| CPU | 500 switches 818.167 → 38.127 ms (95.3%); 20k chunks 236.121 → 84.314 ms (64.3%); 500 tool/chunk pairs 1,747.072 → 69.320 ms (96.0%) | Scroll renderer 2,060 → 2,150 ms (−4.4%); main 40 → 40 ms (0%) | Burst renderer 4,350 → 4,230 ms (2.8%); main 720 → 710 ms (1.4%) |
| MEMORY | Post-GC heap 54.004 → 55.008 MiB (−1.9%); RSS 256.875 → 253.027 MiB (1.5%) | Post-scroll renderer RSS 379.891 → 381.031 MiB (−0.3%); main 439.426 → 439.715 MiB (−0.1%) | Settled renderer RSS 474.770 → 481.625 MiB (−1.4%); main 440.648 → 442.059 MiB (−0.3%) |

Full stage tables: [store](COMPARE-store.md), [Electron](COMPARE-electron.md). Machine-readable aggregates: [baseline.json](baseline.json), [after.json](after.json). Raw rounds and per-launch Electron samples are retained alongside them. `report.py` computes medians of five measured store rounds and three independent Electron runs; it does not choose the best run. Reported p95 values are medians of per-run p95 values, not pooled percentiles.

## Fixed envelopes and reproduction

Use separate worktrees and run phases serially. Baseline is `0d2dcf6`; measured after is `fd60424c4ecd0c297d4390a0c3d2b1fc0b0d3e77`. Copy the two harness files from this PR to baseline. Apply `baseline-ui.patch` to baseline to hold the supplied secondary UX changes constant. Both use the lockfile/common patch from `fd60424` (identical to `0d2dcf6`). Do not measure against uncommitted experimental changes. Exact source/build hashes and rejected runs are in [provenance.json](provenance.json).

```sh
# In each prepared checkout, with dependencies installed from its lockfile:
BACKCHAT_PERF_PHASE=baseline node_modules/.bin/vitest run src/renderer/src/lib/session-store.stress.test.ts --maxWorkers=1 --execArgv=--expose-gc
node_modules/.bin/electron-vite build
BACKCHAT_PERF_PHASE=baseline BACKCHAT_E2E_VISIBLE=1 BACKCHAT_E2E_DISABLE_TRACING=1 xvfb-run -a node_modules/.bin/playwright test e2e/high-load-performance.spec.ts --workers=1 --repeat-each=3
# Repeat the same commands with BACKCHAT_PERF_PHASE=after in the after checkout.
# Collect the eight raw JSON files into this directory, then:
python3 artifacts/perf-stress-20261105/report.py
```

Store: 100 sessions × 200 historical turns plus one 3,000-turn history; 100 live turns; 20,000 round-robin chunks, 500 switches, 500 structural tool/chunk pairs, 1,000 reads. One warmup plus five measured fresh stores. Session-list snapshot stability and turn text/counts are asserted. This is interleaved synchronous reducer work, not 100 provider processes. `--execArgv=--expose-gc` exposes GC inside Vitest workers; merely exposing GC on the launcher did not.

Electron: 24 persisted sessions, 500 + 23 × 50 historical turns, 24 alternating scroll jumps, 24 cold histories, 24 warm switches, 20 asynchronous producers × 40 chunks over real test IPC, 12 simultaneous switches, then three short churn samples. Assertions cover visible history, text selection, virtualization, and readiness. Existing `persistSessionFixture` and `injectEvent` helpers are reused. Five turns were mounted in each accepted run. Browser CPU/RSS means main; Tab means renderer.

Host: Linux 6.12.94+, eight logical Xeon CPUs, Node 24.22.1, Electron 42.11.16 / Chromium 148. Xvfb 1280×1024, GPU disabled. Same worker count and cold/warm sequence. No inference network traffic. Our benchmark invocations were serial; unrelated host activity was not controlled. Small differences should not be treated as demonstrated improvements.

## Attribution and scope

An invariant test counted unrelated `sessionId` reads: the original active-session read touched 41 unrelated turns; the indexed implementation touches zero. The stress workload then quantified the effect with many retained sessions and real selector subscribers.

A separate CDP renderer profile (excluded from timings) found about 2.1 seconds of sampled work around HistoryPager scroll measurement, substantial virtualizer/layout/focus/Markdown cost, but only about 26 ms inclusive in Sidebar and 30 ms in `turnsFor`. Inclusive samples overlap. See [cpu-profile-summary.json](cpu-profile-summary.json). This explains why large store gains do not translate into similarly large Electron gains at 24 sessions.

No new IPC throttling, queue/config/lifecycle guard, SQL schema/index, projection architecture, background process policy, or transcript virtualization semantics are introduced. Existing virtualization remains. Sidebar memoization, bundle splitting, SQL changes, idle-process eviction, layout scheduling, and a long-duration memory soak are deferred for separately profiled work.

The already supplied secondary UX changes remain bundled: search trailing-slot alignment, full-width Settings back row, bound-project empty icon, and Workspace disclosure caret. The follow-up Settings spacer fix reserves room below floating history controls on Linux, avoiding a pointer interception introduced by the full-width row. This settings-only follow-up is outside the chat benchmark; interaction/navigation tests validate it.

Later shared-worktree experiments were deliberately excluded: mutating a published stream event in place breaks final-text projection, and virtualizer/timeline changes were not part of the fixed measured source. A regression test now protects final streaming text. The experiment was concurrently committed as `48d4c10` on the original task branch. Because that branch continued changing during validation, this verified PR uses an isolated branch based on `fd60424`; the experimental branch and PR #115 remain separate and recoverable. The experiment is not included in the reported gains.

## Validation and limits

See [validation.json](validation.json) for commands, counts, and baseline failure names. The new index tests, streaming completion regression, high-load runs, interaction performance, virtual transcript context, renderer recovery, production build, and TypeScript checks pass on the isolated validated source.

The broader targeted suite has pre-existing failures in projection/native-child expectations and source-string UI assertions; the identical failures reproduce on clean `0d2dcf6`. The legacy long-transcript test expects content-visibility skip events despite current virtualization, and the managed-CWD fork test hits an existing global-history-control pointer overlap; both fail on clean main. Expectations and business semantics were not changed to conceal these failures. The PR stays draft.

Existing renderer long tasks remain: median count 93 → 92, total 7,516 → 7,797 ms, maximum 198 → 207 ms. Main cumulative CPU does not prove absence of >50 ms main-thread tasks. Double-rAF is a responsiveness proxy, not measured hardware FPS. Short settled churn shows falling renderer RSS and nearly flat main RSS; it is not a sustained leak test. Retained heap and RSS are different measurements. No 50% memory or whole-app gain is claimed.

## Methodology and references followed

Read and applied the supplied `/workspace/bc-perf-skills/` performance-optimization, frontend-perf, electron-memory-profiler, lazy-render, and conductor-rewrite-performance playbooks: measure, attribute, minimal fix, identical-envelope remeasurement; avoid speculative memoization and main-thread/IPC regressions. Cloud runtime instructions were consulted for the managed environment.

Primary local evidence: `e2e/long-transcript-performance.spec.ts`, `e2e/interaction-performance.spec.ts`, both 2026-09-21 performance audit JSON files, the desktop UI audit's interaction/incremental history sections, SessionStore performance invariants, `docs/main-process-lifecycle-plan.md`, `docs/turn-lifecycle-and-state.md`, and `docs/main-process-projection.md`. Official ACP v1 overview, prompt-turn, extensibility, and session config options were checked before examining protocol-facing paths. No protocol or turn-boundary change was needed.
