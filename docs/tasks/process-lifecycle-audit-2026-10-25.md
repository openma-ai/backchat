# Local process lifecycle audit — 2026-10-25

Scope: static code audit, not a live PID/RSS inventory. No process was killed.
Official reference checked: https://agentclientprotocol.com/protocol/v1/session-setup
Load/resume/close must be capability-gated. No idle policy may discard a session
that cannot recover its context; prompt termination remains authoritative (I1).

## Confirmed code facts / prioritized follow-ups

1. Quit conflates connections and work (P0 UX).
   index.ts needsConfirmation uses hasLocalProcesses OR hosting=backchat.
   SessionManager.hasLocalProcesses only counts #sessions/#starting; an idle
   connected agent and an idle runner both trigger the active-task warning.
   Need an explicit shutdown-impact snapshot: active prompt/steer/queued work,
   pending approval, owned terminals/background jobs, runner work vs hosting.
   Do not merely gate on turns.size: goals and detached jobs can outlive turns.

2. Dead session entries (P1 stale lifecycle risk).
   Shared AcpSession records child exit and exposes isAlive(). Host SessionManager
   never checks isAlive; #startOnce re-acks any existing map entry as ready.
   A crashed idle child can therefore remain logically retained/re-acknowledged.
   Reproduce with fake agent idle exit before adding bounded removal/reconnect.

3. UI terminal owner loss (P1 orphan risk).
   ui-terminal-broker stores ownerWebContentsId; data delivery silently stops
   when owner is absent. No destroyed/render-process-gone hook exists there.
   Normal dispose/onExit clears entries; abnormal renderer/window loss needs a
   deterministic owner cleanup path. Interactive shells must not be TTL-killed
   just because output stopped. Confirm ownership semantics before implementing.

4. Shutdown close may hang (P1, common).
   common AcpSession.#disposeOnce awaits negotiated session/close before setting
   disposed/endStream and killing child. No local deadline around close here;
   unresponsive adapter can prevent the kill fallback from being reached.
   Spawn kill itself has TERM then KILL time bounds. Add close deadline + tests
   at shared runtime seam, preserving protocol capability checks.

5. Idle agent retention (P2 resource policy).
   Sessions stay in #sessions until explicit close/removal/shutdown; no idle LRU
   or TTL observed. Add context-safe suspension (not dispose, which archives).
   Only eligible if no unresolved prompts/queue/asks/goal/background activity and
   negotiated load/resume can restore context; preserve native ID and history.
   Start with observability/manual release before automatic eviction.

6. Archive is NOT termination (intent to clarify).
   SessionsArchive only removes schedule + archives DB row; no child cleanup in
   handler. This is not automatically a bug: decide whether archive means hide
   or stop; never silently terminate ongoing work to save memory.

## Existing cleanup worth retaining
- Startup coalescing, cancelled starts, teardown on start failure.
- Session removal cancellation grace then dispose; disposeAll admission barrier.
- Agent-owned broker terminal group TERM -> KILL + reap; pending asks cancelled.
- UI PTY onExit removes record; explicit dispose and application shutdown kill.
- Runner stop aborts observation/operation and closes bridge/outbox/poll timer.

## Verification plan
Regression first: idle exit -> no false-ready; active vs idle quit; hung close
still kills; renderer owner loss leaves no owned PTY; repeat start/stop cycles
stabilize process counts. No full process-management fix claimed by this audit.

## Implementation: 20-minute idle reclamation
User requested automatic release at 20 minutes. Added per-session unref timer,
capability/ID gate, busy/queue/steer/goal guards and injected broker-work guard.
Preserves native ID/start context in suspended map; restore requests wait for
in-progress teardown. No archive/removal notification. Nonrestorable sessions
remain connected. Unknown native background metadata conservatively blocks.
Focused SessionManager suite: 110/110 pass (virtual clock covers threshold,
resume identity, busy prompt, structured goal, terminal/ask guard and unsupported
restore). Main typecheck and renderer/main build pass. No real process killed
by testing; current running application unchanged.
