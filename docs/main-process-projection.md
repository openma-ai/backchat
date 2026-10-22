# Main-process projection (design)

Status: draft for review, 2026-10-12. Supersedes renderer-side replay in
`src/renderer/src/lib/session-store.ts`.

## Why

Profiling a real 11k-event session showed the renderer spending seconds
re-deriving state from raw events: whole-window replay on every history page,
per-emit WorkItem re-reduction, renderer-only runtime adapters that write
derived events back to main, and two divergent code paths (live `apply` vs
`#replayRows`). The renderer should render; it should not own the event log's
read model.

## Practices this design follows

| Practice | Source | Applied as |
|---|---|---|
| Never block the main process; CPU-heavy work goes to worker threads first, a dedicated process as last resort | [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance) §3 | Projection runs in a `worker_thread` owned by main, not on the main thread |
| Events are the source of truth; projections and snapshots are disposable caches that can be rebuilt from the log | event-sourcing practice ([1](https://kloudvin.com/article/event-sourcing-aggregate-design-snapshots-projections), [2](https://appscale.blog/en/blog/microservices-pattern-event-sourcing-production-snapshots-projections-2026)) | `events` table unchanged; new snapshot tables carry `projection_version`; mismatch → rebuild |
| Projection is a pure, idempotent function; checkpoint committed with the view write | same | one `createSessionProjector()`, dedupe by `event_id`, `last_seq` written in the same transaction |
| Do not snapshot synchronously on the hot path | same | turn snapshots persist on item close / turn stop / every N events, not per token |
| Persist message-shaped state, stream chunks are transient; reconnect = stored snapshot + live tail | [AI SDK resume streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams) | renderer loads turn snapshots, then subscribes to deltas; text deltas never persisted as snapshots |
| Derived state is not written back as events by a reader (dual write) | event-sourcing practice | runtime adapters run once at ingest in main (enrichment before persist); renderer write-back channel `SessionPersistCanonicalEvent` is removed |

## Topology

```
ACP children ──► main: SessionManager → enricher + runtime adapters → append(events)
                                   │ postMessage(event rows)
                                   ▼
                        projection worker (worker_thread)
                        - own node:sqlite connection (WAL)
                        - createSessionProjector() per open/live session
                        - writes turn_snapshots / session_projection
                                   │ deltas
                                   ▼
                        main forwards → renderer (one channel)
renderer: snapshot cache + optimistic overlay + UI reactions only
```

Main keeps the single writer for `events`. The worker is the single writer for
the snapshot tables. Main only forwards deltas (it already forwards every raw
event today, so its load does not grow). If profiling later shows main
forwarding cost, the worker can move to a `utilityProcess` with a
`MessagePortMain` straight to the renderer without changing the protocol.

## Shared projection core (`src/shared/projection/`, pure, no DOM, no Electron)

- `createSessionProjector({ sessionId })` → `{ apply(row): Delta[], snapshot() }`.
  One function for live and rebuild. Absorbs: turn routing by `turn_id`
  (steering as an item of its active turn), `createBackchatTurnProjector`,
  WorkItem projector (common), plans, artifacts, native agents / subagents,
  session latest-wins fields (status, usage, config, commands, auth).
- Runtime adapters (`agent-runtime-adapters`, `native-agent-events`,
  `session-artifacts`) move here and are called by main at ingest.
- UI side effects are emitted as `effects` in the delta (`open_artifact`,
  `notice`, `subagent_ended`), never executed by the projector.

## Storage (new tables, `sessions.db`)

```sql
turn_snapshots(session_id, turn_id, ordinal, projection_version,
               snapshot_json, last_seq, updated_at,
               PRIMARY KEY(session_id, turn_id))
session_projection(session_id PRIMARY KEY, projection_version, last_seq,
                   session_json, work_items_json, plan_json,
                   artifacts_json, subagents_json, updated_at)
```

Rebuild: on open, if `projection_version` differs or `last_seq` < head, the
worker replays only the tail after `last_seq` (or everything on version change).
Raw events stay in `events` for the raw inspector and replay.

## Protocol

- `sessions:loadTurns(sessionId, { beforeOrdinal?, limit })` →
  `{ turns: TurnSnapshot[], hasMore, session: SessionProjection }`. Paging is by
  turn, never by row count (removes partial-head turns).
- Push `session:delta` `{ sessionId, turns?: TurnSnapshot[] (upserts),
  session?: Partial<SessionProjection>, effects?: Effect[] }`, coalesced per
  turn to ≤ 1 per animation frame (~16 ms).
- Push `session:stream` `{ turnId, kind: "assistant"|"thought", text }` for the
  streaming DOM track; transient.
- `sessions:loadTurnEvents(turnId)` for the raw inspector, on demand.

`TurnSnapshot` = today's `Turn` minus `events`, plus the projected
`TurnRender` and the timing fields `projectAcpChatTurn` reads
(`lastEventAt`, thought durations).

## Renderer after the move

- Store holds `Map<sessionId, { turns, session }>` and notifies per-session
  subscribers (no global version).
- Keeps only: optimistic sends / queue overlay (reconciled by `client_id`),
  pending asks, side tabs, notices, history window UI state, fork view.
- Deleted: `#replayRows`, `#rebuildFromWindow`, live `apply` projection,
  `workItemsFor` reduction, `pinDuringSettle`, adapter calls.

## Phases

0. Shared core: extract projector + adapters into `src/shared/projection`,
   prove live == rebuild on recorded fixtures (incl. Guardian interleave).
1. Worker + tables + `loadTurns` / deltas behind a flag; renderer reads
   snapshots for history; live path unchanged.
2. Live path through the worker; remove renderer projection and the
   write-back channel.
3. Remote OpenMA tasks: same snapshot shape (projected in main from the task
   API now; server-side endpoint later in open-managed-agents).

## Coexistence with the standalone `oma bridge daemon`

Both Backchat's embedded runner and the CLI daemon use `~/.oma/bridge[-profile]`
(`credentials.json`, `machine-id`, `daemon.pid`). Backchat checks `daemon.pid`
and the runtime heartbeat: a live external daemon makes Backchat observe it
(`hosting: "external"`) instead of opening a second host; an unverifiable one is
reported as `occupied`. The server also rejects a second execution host. Local
Backchat sessions and the projection worker are unaffected: daemon-hosted cloud
tasks reach Backchat only through the OpenMA task API (phase 3).
