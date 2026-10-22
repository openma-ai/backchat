# Main-process hot path and process lifecycle (plan)

Status: phases 1–4 implemented 2026-10-16 (uncommitted); results below. Companion to
[`main-process-projection.md`](./main-process-projection.md), which owns the
read-model move; this plan owns the write path and child-process lifecycle.

## Why

The Electron main process routes every IPC call and every push to the
renderer. Anything synchronous it does per event is paid on every streamed
chunk. Measured on a read-only copy of a real `~/.oma/sessions.db`
(137,514 events, 204 MB) with `node:sqlite`, the engine main uses:

| Cost per persisted event | 43.6k-row session | 14.4k-row session | 6.5k-row session |
|---|---|---|---|
| `canonicalEventExists` dedupe scan | **50.6 ms** | **22.5 ms** | 0.9 ms |
| `sessionEventCount` (`COUNT(*)`) | 0.76 ms | 0.25 ms | 0.11 ms |

The dedupe query applies `json_valid` + `json_extract` to every row of the
session because no index covers `event_id`; a new event never matches, so the
scan always runs to the end. In the 43.6k-row session 43,599 rows are
`openma_event`, so every streamed chunk and every terminal output chunk
(`brokers.ts` → `session.background_process` → `appendEvent`) pays it. Total
work grows O(n²) with session length, on the thread that serves the UI.

Two smaller costs sit on the same path:

- The enricher seeds a session's sequence with
  `latestPersistedOpenMAEventSequence(loadHistory(id))` (`ipc.ts:461`): a full
  read (62 ms, ~29 MB, then `JSON.parse` per row) to obtain one number.
- `appendEvent` → `writeTranscriptEvent` does `getSession` + `mkdirSync` +
  `appendFileSync` per event.

Separately, harness-spawned terminals (`brokers.ts:365`) are not process-group
leaders and are stopped with a single `SIGTERM` to the direct child, with no
escalation. `npm run dev`-style commands leave grandchildren that keep ports
after the session ends or the app quits.

## Practices this plan follows

| Practice | Source | Applied as |
|---|---|---|
| Never block the main process; offload CPU work to workers first, a separate process only when needed | [Electron: Performance](https://www.electronjs.org/docs/latest/tutorial/performance) | Make per-event main work O(1) first; the projection worker in the companion doc takes the read model off main |
| Index the expression the query uses; the planner only uses an expression index when the query repeats the expression exactly | [SQLite: Indexes on expressions](https://www.sqlite.org/expridx.html) | Partial index on `(session_id, json_extract(data,'$.event_id')) WHERE type='openma_event'`; lookup written with the identical expression |
| Let the database enforce uniqueness instead of check-then-insert | [SQLite: UPSERT](https://www.sqlite.org/lang_upsert.html) | `INSERT … ON CONFLICT DO NOTHING`; side effects (transcript line) only when `changes === 1` |
| Kill a child's whole process group, not only the direct child | [Node.js: `options.detached`](https://nodejs.org/api/child_process.html#optionsdetached) | Spawn terminals with `detached: true`, signal `-pid`, escalate `SIGTERM` → `SIGKILL` after a grace period |
| Fix with a failing test first, accept with before/after numbers | project convention | Each phase lists its red test and the measured acceptance bar |

Not adopted: moving the session store into a `utilityProcess`. After phase 1
each append is sub-millisecond, and the store has a single writer by design;
a process hop would add IPC latency and a second failure domain for no
measured gain. Revisit only if a profile after phase 3 shows main-thread
store time above the budget below.

## Facts checked before choosing the design

- No duplicate `(session_id, event_id)` pairs and no `openma_event` rows
  without `event_id` in the measured DB, so a unique index can be created.
  The migration still checks first (see phase 1) because other users' DBs
  may differ.
- Index build on 137,514 rows: **1.7 s once**; indexed lookup **0.007 ms**
  (plan: `SEARCH events USING INDEX … (session_id=? AND <expr>=?)`),
  measured with Node 24 `node:sqlite` (SQLite 3.53.1). Electron 42's bundled
  SQLite version is not yet confirmed; phase 1's `EXPLAIN QUERY PLAN` test
  runs under the app's own runtime and is the check.
- `openma_event.seq` is not monotonic in row order (132 of 123,855 rows go
  backwards across 2 sessions; 195 have no `seq`). "Read the last row" is
  therefore wrong; the seed must be a true `MAX`.

## Phases

Each phase is one PR, red test first, then the fix, then the measurement.

### Phase 1 — O(1) event append (P0)

1. Migration in `openSessionDb` (`sql-store.ts`), idempotent, logged as an
   `app.startup_stage`:
   - count duplicate `(session_id, event_id)` pairs among `openma_event`;
   - zero → `CREATE UNIQUE INDEX IF NOT EXISTS events_openma_event_id_idx …
     WHERE type = 'openma_event'`;
   - non-zero → create the same index non-unique, log the count, keep an
     indexed pre-check. Never delete rows in a migration.
2. `appendEvent`: replace the scan with `INSERT … ON CONFLICT DO NOTHING`
   (unique case) or the indexed pre-check (fallback). Write the transcript
   line only when a row was inserted.
3. Replace per-append `COUNT(*)` with an in-memory per-session counter seeded
   once with `COUNT(*)`; invalidate on session delete/import.
4. Cache the transcript directory per session; drop per-event `getSession` +
   `mkdirSync`.

Red tests (`src/main/sql-store.test.ts`):
- appending an `openma_event` whose `event_id` already exists inserts no row
  and writes no transcript line;
- `EXPLAIN QUERY PLAN` of the dedupe statement uses
  `events_openma_event_id_idx` (guards the exact-expression rule);
- migration on a DB seeded with a duplicate falls back to the non-unique
  index and loses no rows.

Acceptance: dedupe ≤ 0.1 ms per event on the 43.6k-row fixture (was
50.6 ms); total `appendEvent` p95 ≤ 1 ms; FTS row counts unchanged before and
after the migration.

### Phase 2 — cheap sequence seed (P1)

1. Add `events_openma_seq_idx` on
   `(session_id, json_extract(data,'$.seq')) WHERE type = 'openma_event'`
   in the same migration.
2. `latestPersistedOpenMAEventSequence` becomes one
   `SELECT MAX(json_extract(data,'$.seq'))` using that index, keeping the
   `oma.event.v1` schema check semantics (rows without `seq` are ignored).

Red test (`session-event-enricher.test.ts`): a session whose last row has a
lower `seq` than an earlier row seeds from the true maximum.

Acceptance: seed ≤ 1 ms on the 43.6k-row fixture (was 62 ms + parse of
~29 MB).

### Phase 3 — terminal process groups (P2)

1. `brokers.ts` `createTerminal`: `spawn(…, { detached: true })` on POSIX;
   keep the default on Windows.
2. One `terminateTerminal(rec, reason)` used by `killTerminal`,
   `releaseTerminal`, and `cancelPendingFor`: `process.kill(-pid, "SIGTERM")`,
   then `SIGKILL` the group after 3 s if `exit` has not fired.
3. Quit path: `disposeSessionsForShutdown` awaits all pending terminations
   (bounded by the same grace period) so the quit coordinator does not exit
   while groups are alive.

Red test (new `brokers-process-group.test.ts`, POSIX only): spawn `sh -c 'sleep 60 & wait'`,
release the terminal, assert the grandchild pid is gone within the grace
period; a child that traps `SIGTERM` is gone after escalation.

Acceptance: zero surviving descendants after session dispose and after app
quit in the test above; no change to terminal output or exit events in
`background-process-canonical.test.ts`.

### Phase 4 — main-owned caches (P2)

- GitHub repository image: persist last-known-good in main (keyed by
  repo, with fetched-at), serve it immediately, refresh in the background;
  a failed refresh never overwrites a good value with `null`.

Acceptance: after a renderer reload, project avatars render from cache with
no `gh` call; a simulated `gh` timeout keeps the previous avatar.

## Budget and measurement

Main-thread budget for persisting one streamed event: **≤ 1 ms p95**,
independent of session length. Measure with a script against a copy of the
real DB (never the live file), reporting p50/p95 for 1k appends into the
largest session before and after each phase, plus the one-time migration
time. The harness probe change from 2026-10-15 is the precedent: before/after
counts from `backchat.log`.

## Risks and rollback

| Risk | Mitigation |
|---|---|
| One-time 1.7 s index build on large DBs delays first window | Logged as a startup stage; runs once. If it exceeds 3 s on a user DB, move it after `window_ready_to_show` with the indexed pre-check unavailable until it finishes (old scan as interim) |
| Unique index creation fails on a DB with duplicates | Duplicate count checked first; fallback to non-unique index |
| Query stops using the index after a refactor | `EXPLAIN QUERY PLAN` test in phase 1 |
| Killing a process group hits an unrelated process | Only negative pids of groups we created with `detached: true` |
| Rollback | Indexes are additive; dropping them restores current behavior. Code changes are per-phase PRs |

## Results (2026-10-16)

Measured on a copy of the real DB (137k rows), 1,000 `appendEvent` calls of
a new `openma_event` into the 44.6k-row session, real `sql-store.ts` before
and after, Node 24 `node:sqlite`, two runs each:

| | Before | After |
|---|---|---|
| `appendEvent` p50 | 52–57 ms | 0.33–0.34 ms |
| `appendEvent` p95 | 81–123 ms | 1.0–1.3 ms |
| 1,000 appends total | 57–68 s | 0.43–0.52 s |
| Sequence seed | 147 ms p50 (`loadHistory` + parse) | 0.4–0.5 ms |
| One-time migration (both indexes) | — | 0.64–0.78 s |
| Duplicate append rows | 0 | 0 |

The seed SQL returned the same value as `latestPersistedOpenMAEventSequence`
for all 123 sessions. p95 is at the 1 ms budget, not clearly under it: the
remainder is `appendFileSync`, the FTS trigger and JSON encoding, not
lookups. Phase 3 tests (`brokers-process-group.test.ts`) failed 4/4 before
the change with `sleep` grandchildren left running, and pass after.

Deviations from the plan: the migration tries the unique index and counts
duplicates only if that fails (no extra full scan on the common path); a
fallback DB stays non-unique until rows are cleaned by hand. The repository
image cache also backs off for 10 min after a failed refresh.

## Out of scope here

- Moving projection off the renderer: see
  [`main-process-projection.md`](./main-process-projection.md).
- Renderer CPU profiling and the turn-completion layout shift: tracked in the
  backlog, measured separately.
