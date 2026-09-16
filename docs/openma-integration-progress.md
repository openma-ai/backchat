# Backchat OpenMA integration — implementation tracking

The accepted scope is the complete desktop login / optional local runner /
other runners and cloud task workflow. This is in progress, not a completion report.
Preserve the pre-existing uncommitted worktree, local session and chat changes.

## Current accepted daemon lifecycle (supersedes the earlier takeover proposals)

The user accepted: the hosting application or independent supervisor owns the
daemon's lifetime. Other clients connect and disconnect without acquiring stop
rights. Prefer an existing compatible host; only start a Backchat host when none
is available. Do not transfer ownership automatically while it runs. Research
is no longer blocking this lifecycle work; no generic process manager was chosen.

Implemented in this batch:

- `OpenmaRunnerState.hosting` distinguishes `backchat`, `external`, and no host.
  Existing credentials are verified against the user's authorized runtime list
  and machine-token identity, including the selected workspace. Online external
  hosts are reused through the existing OpenMA task APIs. This does not introduce
  a local daemon RPC endpoint or a new public API.
- An external host is observed every ten seconds. Disconnect, application exit,
  logout and authorization loss stop only that observation. Its credentials are
  preserved. An outage does not trigger automatic replacement. A stale D1 online
  row is checked against RuntimeRoom's existing 90-second heartbeat lease.
  A live PID without verifiable credentials remains a startup blocker.
- An initial attachment conflict switches the client to observing the winning
  host; a Backchat host that has already been online does not transfer ownership
  through this path. The service's execution lease remains authoritative.
- Backchat-owned runners keep running after window close. Explicit app exit or
  logout stops the owned bridge. The settings explain the different lifetimes.
  Independently managed local runners remain selectable through OpenMA; their
  directories cannot be overwritten by Backchat project linking.
- CLI and desktop now consume the same pure `DaemonConnection` implementation.
  Both consumers import the versioned `@openma/common/local-runtime` package;
  the desktop source snapshot has been removed. Heartbeats, stale callback fencing,
  reconnect and terminal attachment rejection are shared. Existing host adapters
  retain session execution and persistence. This is not yet a separately packaged
  daemon executable or a general local service-management framework.

Validation: Backchat typecheck and build passed; its curated CI lane passed
51 files / 361 tests before the final startup-conflict case was added. The final
focused runner/bridge/project suite passed 23 tests. OpenMA runtime passed
37 tests; CLI passed 18 tests, typecheck and build. Three real Electron E2E
scenarios passed (login/owned runner/approvals/offline output, cloud restart
recovery, and external daemon reuse across app quit/restart/disconnect/logout).
The E2E service boundaries are loopback fixtures on macOS; they are not a
two-physical-machine or native Windows/Linux qualification. Both worktrees pass
`git diff --check`, and the shared connection snapshot matches its source.

No live installed daemon, system service or user credential file was changed.
The full integration scope and the remaining issues below are still in progress.

## Accepted product clarification

The user clarified that a Backchat project should correspond to an OpenMA
environment. A runner identifies a machine/execution host; it is not itself the
environment and registration must not model the user's whole computer as one.
One runner can host several explicitly linked project environments. Execution
must resolve the selected environment to that runner's project/primary directory
and additional roots, not accept arbitrary caller-supplied local paths. Cloud
projects link to cloud environments. Keep account, runner, project/environment,
and task as distinct identities. This is part of the implementation goal.

The user also suggested creating a fresh directory and Git repository by default,
like starting an anonymous conversation. An optional clarification was sent for
the apparent typo “心间匿名会话”; no reply yet. Proceeding with “start chatting,
then name/organize the project”: managed local task workspaces initialize Git on
first execution, without requiring a project name. Existing explicit project
directories are not initialized or uploaded by this path.

## Implemented and exercised

- Desktop account in `src/main/openma-account.ts`: existing browser `/cli/login`
  handoff, real loopback server, state check, cancellation, per-workspace identity
  verification, separate private account file, workspace selection and logout.
- Settings and execution-menu login entry; main/preload interfaces; EN/ZH labels.
- `OpenmaRunner`: explicit opt-in, separate `/connect-runtime` flow, v2 shared
  runner credentials, owner verification, legacy credential refresh, PID occupancy
  guard. Wired to main process and settings; removed unconditional startup attach.
- Bridge connection state, fatal occupied/expired responses, workspace guards.
- v1 SDK snapshot under `packages/openma-sdk`, copied unchanged from OpenMA
  commit f35a84ef209c1f48113c8a9d003e1da6c4eea690. npm tags still point to 0.1.x.
- SDK cloud transport separates send from subscribe, resumes by numeric seq via
  Last-Event-ID, disables automatic mutation retries, sanitizes errors.
- SDK execution catalog loader joins runtime manifests to bound agents; this
  loader is connected to the execution selector, including environments, actual agent bindings and offline gating.
- Project/environment links now have a SQLite store scoped by server, user and
  workspace, with a separate durable record pinning each runner task's directory.
  Settings exposes link/unlink and the existing OpenMA management entry. Only
  project identity/name and runtime ID are published as environment metadata;
  filesystem paths stay local. Cloud links do not register a runner.
- Runner project resolution uses the current SDK's session retrieval with the
  message workspace's runner key to read `environment_id`, then resolves an
  explicit local project binding. No public API or internal relay change was
  needed. Unlinked environments and arbitrary caller cwd values cannot trigger
  execution outside the configured project selection. This is directory routing,
  not a new OS filesystem sandbox.
- Managed anonymous local sessions now create an empty Git repository, coalesce
  simultaneous directory preparation, and validate IDs before path construction.
  Missing Git no longer prevents a local task: keep the directory and initialize
  it on a later start after Git becomes available, preserving existing work.

## Verification so far

- Typecheck and build passed after login/runner integration.
- New account, runner, bridge, catalog and SDK tests have passed their targeted runs.
- `e2e/openma-account.spec.ts` passes using real Electron main/preload/UI,
  loopback authentication, private persistence and a WebSocket fixture server.
  Browser launching alone is replaced in the test. It covers login without
  registration, selecting workspace, opt-in runner connect, reload, and logout.
- Expanded smoke run: 33 passed, 2 layout assertions failed (activity icon
  alignment and footer alignment). Still needs diagnosis/baseline comparison;
  do not claim the full regression gate is green.
- Current typecheck and curated CI passed: 48 files / 333 tests. Replaced an
  obsolete private-field spelling check in the lifecycle source contract with
  inclusion of the existing SessionManager behavior suite and a late-output /
  queued-prompt disposal regression (75 tests in that suite). Fixed the OpenMA
  page's literal title to use i18n. Anonymous workspace tests exercise real Git.
- Project link/unlink service tests cover runner ownership, preserved environment
  metadata and retrying remote cleanup after local unlink while offline.
- Expanded `e2e/openma-account.spec.ts` passes (4.1s): after linking via settings,
  a WebSocket fixture sends a task through the real Backchat bridge and an
  independent ACP fixture process. It checks unlinked-environment rejection,
  persisted project/cwd, a file produced in the linked directory despite a
  different caller cwd, completed turn, unlink metadata cleanup and logout.
  This is not yet a real two-machine OpenMA deployment acceptance run.
  Hidden Electron tests explicitly disable background throttling, and the new
  selects have explicit labels so Playwright and assistive clients can find them.
- SDK streaming now opts into OpenMA's `include=chunks` extension in addition to
  SDK event_deltas. The empty 202 input response is covered by a contract test;
  the SDK already accepts it. Chunks have no durable seq and must be handled as
  transient projections replaced by committed messages in the observer.

## Remote task batch (implemented)

- `OpenmaTaskStore` persists scope, fixed execution target, session ID, ordered
  events/cursor and durable outgoing operation IDs in desktop SQLite. Events and
  cursor commit atomically. Conflicting ID/seq combinations fail closed; history
  may enrich a sequence-less event. Uncertain sends survive restart and are
  reconciled from metadata without automatic retries.
- `OpenmaTasks` validates target/agent/environment against the current catalogue,
  creates tasks, discovers existing workspace tasks, opens history and resumes
  subscriptions. Logout/workspace changes stop observers only. Reconnect reads
  history before subscribing and preserves remote status while disconnected.
- History uses SDK requests plus numeric `after_seq` adaptation for v1 stored
  event rows; the standard SDK opaque page token does not work on this route.
- Streaming uses the SDK endpoint and public `Stream.rawEvents` reader from the
  pinned underlying Anthropic SDK. The normal parsed stream filters out OpenMA
  chunks and pending-input frames. Tests cover fragmented UTF-8, SSE framing,
  committed text replacing transient text, and promotion frames never advancing
  the durable history cursor.
- Empty 202 input/approval responses are acknowledged without JSON parsing, even
  if middleware sets application/json. The latter previously produced false
  connection errors after a successful approval; the regression test fails
  against the earlier implementation.
- Main/preload task APIs and scoped renderer hook restore task list/history.
  Draft execution selection chooses a project environment and actual agent.
  Created task locations are fixed. Remote composer works with zero local
  harnesses. No local sessionStart/sessionPrompt is used for remote work.
- Existing message/tool/approval/user-form components render remote snapshots.
  Confirmation and custom-result responses use service request IDs and original
  thread IDs. Repeated response operation IDs cannot duplicate a submission.
- Existing remote outputs and attached file resources are listed through SDK
  calls. The Files control previews text/raster images and offers explicit Save
  through a main-process native dialog. Preview is capped at 4 MiB; Save at
  64 MiB, with OpenMA management as the existing fallback for larger files.
- Local terminal/side-chat/runtime-update controls are omitted on remote tasks.
  File paths are resolved only against remote task files; loopback web links do
  not open against the user's computer. Public web links open externally.
- `e2e/openma-cloud.spec.ts` passes with real Electron main/preload/renderer and
  an HTTP/SSE fixture: login without runner/local agent, choose cloud environment,
  submit once, tool confirmation, custom user reply, tool result, output preview,
  reload/reopen, and disconnect notice. Exactly one creation and three event
  POSTs (input + confirmation + reply), including after history restoration.
  Both OpenMA E2Es pass together (8.4s); these are fixture services, not a live
  two-machine deployment.
- Latest typecheck/build and curated CI pass (48 files / 333 tests). Additional
  affected renderer suites: 182 pass, 9 baseline failures. Three new integration
  test failures were stale dropdown mocks/source assertions and were corrected.
  The remaining nine were reproduced with HEAD SessionStore and ChatTurn with
  only this batch's one streaming key removed; temporary baseline files were
  removed. Failures concern pre-existing native subagent/background-output shapes,
  side workspace round-trip, and completed-thought projection. Logs:
  `/tmp/backchat-remote-{ci,build,typecheck,e2e,renderer-tests,baseline,ui-tests}.log`.

## Runner association and observer ownership batch

- A runner execution now has a deterministic local ID scoped by server, user,
  workspace and remote session. The remote observer task uses a separate ID.
  `openma-identity.ts` shares the existing desktop task ID algorithm without
  changing previously persisted observer IDs.
- `OpenmaProjectEnvironments.resolveRunnerSession` persists the association,
  agent, runtime, environment and pinned project roots before the host starts.
  Restart and relinking preserve that identity; changing an existing task's
  execution agent/runtime/environment is rejected.
- The bridge indexes incoming commands by workspace plus remote ID, and maps
  host events back to original wire IDs. Equal remote IDs in distinct workspaces
  can run independently. Prompts, cancel and dispose wait for the scoped host
  startup. Local-only session events cannot be relayed by coincidental raw IDs.
- Local list, archive list, search and broadcast paths omit these execution
  copies, including after logout/restart. Local session IPC rejects direct
  mutation/history access to a linked runner execution; the OpenMA observer is
  its user-facing task and operation route. SQL and on-disk local history remain.
- Observers have per-mounted-view ownership, scoped by Electron webContents in
  main. Closing a view releases only its ownership. Reload, renderer loss and
  window destruction clean up that window's subscriptions. Creating a task no
  longer implicitly retains an observer. Logout and application shutdown still
  stop all observers without mutating remote tasks.
- Distinct remote assistant/thinking messages retain paragraph boundaries;
  chunks of a single message still concatenate. This fixes adjacent committed
  responses being displayed as one sentence.
- New regressions were observed failing before their fixes: workspace ID
  collision, missing durable association, another view's detach stopping the
  shared observer, missing Git preventing local tasks, and merged paragraphs.
  Typecheck, build and curated CI now pass (48 files / 338 tests).
- The account Electron scenario additionally verifies persisted scoped execution
  IDs, real linked-directory output, blocked direct local input, a single
  observer row after reload, and no leaked execution row after logout.
- The expanded cloud Electron scenario passes through the actual New Window
  menu: two windows share one subscription, the first keeps receiving events
  when the second closes, and a complete main-process exit leaves service status
  running. The fixture finishes work while Backchat is closed. A fresh Electron
  process restores account/history, shows that output and its file, skips already
  answered approvals, and continues the same task. There is still exactly one
  creation, three original event POSTs and one intentional continuation POST.
  Both OpenMA E2Es pass together (11.0s). These remain fixture service tests;
  a real two-machine deployment has not yet been exercised. Logs:
  `/tmp/backchat-final-batch-{ci,typecheck,build,e2e}.log`.
  A final lifecycle extension also passes (9.8s): leaving the last task view
  drops the service stream to zero without a mutation, reopening restores it,
  and the old main process exits with code 0 and no signal (not the helper's
  forced-kill fallback). Log: `/tmp/backchat-final-batch-lifecycle.log`.
- CLI takeover inspection found that launchd KeepAlive restarts a killed daemon
  and the current CLI has no atomic local yield/active-task control operation.
  Safe takeover still needs a shared local ownership/control contract; merely
  reading daemon.pid and sending SIGTERM is insufficient. No CLI process or
  installed service was altered during inspection.

## Remaining work (keep full scope)

1. Runner explicit takeover with live-task guard (currently only detects and
   blocks CLI occupancy), refresh/reconnect controls and existing-config state.
2. Runner context/bundle/tenant MCP credentials and remaining callback kinds.
   Scoped local IDs, durable associations and permission selection are implemented.
   Network output recovery is implemented in the batch below. Recovery after
   eviction of the service's active translator/native child still needs durable
   turn admission, consumer state and log retention/cleanup.
3. Cancellation races, workspace switch during in-flight create, and live
   multi-machine acceptance. Multi-window observer ownership and full-process
   cloud exit/restart now have successful Electron fixture coverage.
4. Task list action routing, metadata refresh, desktop archive/restore and scoped
   cached search are implemented in the task-list batch below. Remote content
   search currently covers downloaded history; server-wide full-text search is
   not available through the current contract.
5. Audit pending input replay, queued-turn placement and streamed message/thought
   replacement across repeated reconnects, service errors and concurrent clients.
   Custom results use the existing generic form; provider-specific questionnaire
   metadata and runner elicitation/write-outside-root callbacks still need
   remote routing and end-to-end coverage.
6. Broader remote resource capability discovery and file references: no local
   filesystem fallback; current Files button supports outputs/resources. Relative
   markdown links may remain inert without cwd; terminal/browser remote surfaces
   are omitted until an actual target capability can be routed.
7. Project/environment grouping in task lists and regression fixes/baseline comparison for the nine
   renderer failures and earlier two smoke layout failures.
8. Enabled runners now keep the main process alive when the last window closes
   on every platform. macOS Electron execution/close/reopen is verified below;
   Windows/Linux native integration checks remain outstanding.
9. Packaged SDK verification, visual QA and all original acceptance criteria.
   Do not mark the goal complete before the full scope is demonstrated.

ACP v1 prompt/session docs were read on 2026-09-14 at
https://agentclientprotocol.com/protocol/v1/prompt-turn and
https://agentclientprotocol.com/protocol/v1/session-setup. Root `/protocol/v1`
was initially unreachable; the specific official pages were reachable.

Useful logs from the current run are under `/tmp/backchat-openma-*.log`.

## Runner permission relay batch

- Corrected the bridge's actual ACP event envelope to include `sessionId` and
  `update`, which the v1 `AcpTranslator` expects. PromptResponse stop reason and
  usage now precede `session.complete` as an opaque `promptComplete` event.
  Reannouncing `session.ready` preserves a running turn (lifecycle invariant I1).
- Runner permission callbacks stay owned by their scoped execution session and
  original turn. They emit `client.request` in the existing `session.event`
  transport, replay while pending, and accept only matching workspace/session/
  turn/request IDs and original option IDs. Duplicate responses acknowledge
  without resolving the ACP callback twice; local cancel/disposal settles it as
  cancelled. These asks no longer appear in the local broker UI.
- Added internal `session.response` relay in the sibling OpenMA repository.
  RuntimeRoom takes session/workspace from its authenticated attachment and
  keeps the original callback payload. No public HTTP endpoint or SDK changed.
- The real `AcpProxyHarness` now installs its inbox before accepting the socket,
  serializes asynchronous translation, and represents a waiting permission via
  existing `agent.custom_tool_use` / `requires_action` events. A custom result
  resumes that callback's original ACP turn without another `session.prompt`.
  The pending request is removed after the native host's acknowledgement,
  guarded by the existing execution fence.
- Shared desktop normalization restores original permission buttons from remote
  history. Selection/cancellation uses the existing custom-result API with the
  original ACP outcome; ordinary cloud tool confirmations retain their route.
- Backchat typecheck and build pass; curated CI: 49 files / 342 tests. OpenMA
  root TypeScript and runtime-relay package TypeScript pass. Actual proxy and
  translator suites: 10 tests; RuntimeRoom/route integration suite: 19 tests.
  Logs: `/tmp/backchat-runner-actions-{typecheck,build,ci,green}.log`,
  `/tmp/openma-runner-actions-{root-typecheck,tests,relay-integration}.log`.
- Expanded account Electron test passes (8.6s total): a real ACP subprocess
  waits for permission; no file exists beforehand; leaving/reopening restores
  the ask; clicking the original option writes only in the linked project;
  exactly one response and one native completion are observed. Cloud exit and
  restoration Electron scenario also passes. The first account run exposed a
  missing `ts` field in the fixture's stored-event envelope, then passed after
  correcting the fixture to the service contract. Logs:
  `/tmp/backchat-runner-actions-e2e.log`,
  `/tmp/backchat-runner-actions-e2e-account.log`.
- Full acceptance remains open: paused-callback interruption is implemented in
  the next batch below; proxy transport failure must preserve/recover the
  outstanding continuation; bridge output catch-up is still missing. Form/URL
  elicitation and outside-root write approvals still use local broker paths.
  These tests use fixture service boundaries, not two physical machines or a
  deployed end-to-end OpenMA service. Do not mark the full plan complete.

## Paused runner interruption batch

- Reproduced the real SessionDO `/event` defect: a `user.interrupt` while
  `acp-proxy` had paused for permission returned success without sending any
  native cancellation. Added an optional harness `interruptPending` port so the
  session host can resolve the existing harness after an idle period/eviction,
  without importing a concrete adapter or creating another prompt.
- The proxy attaches to the original runtime with session/workspace headers,
  sends `session.cancel` for the callback's original turn, and waits for the
  execution host's completion. Disconnect/offline/error/timeout leaves pending
  callbacks intact and returns a 503 through the existing event API, rather than
  claiming completion. Pending queues are still cancelled by the existing
  interrupt authority. Background retry of an unconfirmed interrupt is not
  implemented; the user can reconnect and retry intentionally.
- Only acknowledged callback IDs in the addressed thread are removed from
  persisted pending state. A matching error tool result closes their activity,
  followed by the existing idle event. Other threads' callbacks remain. Repeating
  an interrupt after successful settlement sends no second cancellation and
  emits no duplicate idle marker. Legacy states without `pending_tool_calls`
  retain their queue-interrupt behavior (caught by existing thread regressions).
- Added Stop to the remote task menu so it remains accessible while an approval
  replaces the composer. Closing a runner permission card now returns ACP's
  cancelled outcome, including when the agent supplies only allow options;
  it cannot implicitly select that option.
- A real ACP Electron run exposed a second defect: SessionManager represented
  cancellation as `session.cancelled` but discarded the actual PromptResponse,
  so the bridge never forwarded its terminal event. Cancellation now carries
  optional stop reason/usage/metadata evidence. The bridge forwards completion
  only when that evidence exists (I1); iterator abort alone is not proof.
- Validation: Backchat build and typecheck passed; curated CI is 49 files /
  343 tests. Both account/runner and cloud Electron scenarios pass together
  (12.2s), including permission cancellation via the visible task menu, a native
  cancelled stop reason, removed approval, and exactly one interrupt submission.
  OpenMA's actual SessionDO handler/proxy/SQLite tests cover success and broken
  connection, persisted pending state, thread isolation and repeat interrupt;
  those plus existing queue/thread and proxy regressions total 30 passing tests.
  Logs: `/tmp/backchat-pending-interrupt-{ci,typecheck,build,e2e-final}.log` and
  `/tmp/openma-pending-interrupt-{regression,typecheck}.log`.
- Requested the user's intended two real runners and test workspace via an
  asynchronous question. This does not block remaining implementation. A live
  two-machine acceptance run, CLI takeover, disconnected output recovery,
  remaining callback kinds, and the other items above are still outstanding.

## Runner output recovery batch

- Added a private SQLite output queue owned by Backchat's runner, scoped by
  service/account/runtime and workspace/session. Frames are committed before
  sending. Stream IDs and increasing sequence numbers survive process restart;
  only scoped cumulative receipts remove pending rows. An invalid workspace,
  session, stream or future sequence cannot acknowledge another task's output.
- The bridge now records output, permission requests/responses and real native
  completion while disconnected. Reopening drains unconfirmed output without
  replaying user input. Its local lifecycle still waits for native evidence.
- Added an internal relay capability `durable_session_events_v1`, per-frame
  `delivery: { stream_id, seq }` and `session.ack`. RuntimeRoom stores raw output
  before acknowledging it, drains contiguous sequences, drops duplicate delivery
  and rejects content/scope changes to an existing sequence. Legacy CLI wire
  behavior remains accepted. Backchat with an older service keeps best-effort
  delivery; after its queue drains a fresh stream avoids gaps on service upgrade.
- New harness attachments can request one original turn after per-stream cursors
  using `x-runtime-replay`. Replay precedes later live delivery. Task/workspace
  pins now persist across observer closes and DO hibernation; an attachment cannot
  move a pinned task into a different workspace. No public HTTP API was added.
- AcpProxyHarness reconnects a lost output socket within the active run, retaining
  its translator and last consumed sequences. Even an ambiguous socket write
  does not cause a second prompt. Approval continuations retain their cursor and
  consume output in order around the response acknowledgement. Duplicate callback
  replies are safe to resend by original request ID; native input is not resent.
- The Electron account scenario now drops a receipt and the runner socket during
  a real ACP subprocess turn. The subprocess finishes a file in its linked
  project while disconnected. The test observes the pending on-disk output,
  reconnects, receives both text chunks and real stop reason, then confirms the
  queue drained. The first frame arrives twice on the wire but once at the service
  boundary; a native prompt counter proves the turn executed once. The initial
  run exposed a fixture polling issue (ENOENT escaped before retry), then passed
  after fixing the poll. This still uses a service boundary fixture, not two
  physical runners.
- Remaining recovery work is explicit: persist active proxy/translation state
  across worker eviction, durable admission of native prompts, restore bridge
  ownership/pending callbacks after native process loss, and prune raw relay logs
  only after durable consumer progress. Runner-link connectivity also needs to
  reach the task UI independently of the desktop's SSE connectivity. These are
  separate from the now-tested live-process socket reconnection paths.
- Validation: Backchat typecheck/build and curated CI pass (50 files / 346
  tests). OpenMA root TypeScript and six relevant relay/proxy/queue/thread suites
  pass (62 tests); the final relay/proxy rerun passes all 24 tests after the last
  small corrections. Both Electron account/runner and cloud exit/restart scenarios
  pass together (21.8s). `git diff --check` passes in both repositories.
  Logs: `/tmp/backchat-runner-recovery-{ci-final,typecheck-final,build-final,e2e-final}.log`,
  `/tmp/openma-runner-recovery-{regression,core-final,typecheck-final}.log`.

## Task list actions and desktop organization batch

- Remote rename now uses the SDK session update endpoint. Pin/archive/restore
  are personal desktop preferences in SQLite, scoped through the existing task
  identity. Archiving never terminates or deletes the remote session, and a
  failed rename does not update the displayed title or automatically retry.
- Metadata pushes reach other windows, while workspace/account checks reject
  stale results. A desktop revision protects successful mutations from older
  catalog responses and preserves loaded history/approval state during refresh.
  Mutations are serialized per task; preferences survive cache refresh/restart.
- The existing Archive page includes the active workspace's remote tasks and
  restores them through the remote desktop-preference route. Permanent deletion
  remains a local-chat action. Cmd+K searches remote titles and downloaded chat
  prose, including archived tasks, alongside the existing local search. Search
  results carry the remote association before opening, preventing local fallback.
- Tests reproduced preference loss, stale title rollback and wrong action
  routing before implementation. Curated CI passes (51 files / 354 tests),
  the three affected shell suites pass (29 tests), and typecheck/build pass.
  The extended cloud Electron scenario passes (9.4s): rename/pin/archive while
  running, clean main-process exit, service completion while closed, title
  search after relaunch, history/files, archive-page restore and continuation.
  Exactly one create, one title update and four intentional event submissions
  occur; archive/restore and navigation do not send remote mutations. Two initial
  UI test failures were test navigation mistakes (memory history, then the
  settings-specific sidebar); both were corrected using visible UI controls.
  The account/runner Electron scenario also passed in the preceding combined run.
  Logs: `/tmp/backchat-task-list-{typecheck,build,ci-final,shell-tests,e2e-cloud}.log`.
- Protocol boundary clarification: remote clients consume the OpenMA SDK event
  contract; OpenMA harnesses/adapters own provider protocol adaptation. Backchat
  retains its local execution path, runner transport bridge and UI projection.
  Shared protocol code can run locally; local tasks need no cloud round trip.
  These changes do not claim that every existing converter has been extracted.

## Runner background lifecycle batch

- Closing the last window keeps an enabled Backchat runner alive across the
  platform branches. Explicit Quit still uses the existing shutdown barrier;
  account logout still disconnects only the Backchat-owned runner. Without a
  runner, existing production local-app platform behavior is preserved.
- Removed the test-only last-window forced quit, so the Electron fixture now
  exercises the production close path. Fixture teardown already calls explicit
  Quit and requires no production test exception. Settings explain that closing
  windows preserves the runner while Quit/sign-out stops it, in both languages.
- The real ACP/Electron scenario first failed: closing the only window stopped
  the runner before native completion. It now completes its original turn with
  no windows, writes within the linked project, and retains the runner socket.
  A new window through the existing menu sees that same online runner. The
  following logout still disconnects it. No system daemon/service was changed.
- Validation: typecheck, build, curated CI (51 files / 354 tests) and both
  Electron account/runner and cloud restart scenarios pass (26.7s combined).
  The OS was macOS; Windows/Linux native close/reopen and shutdown behavior
  still need their own integration run. Electron lifecycle semantics were
  checked against https://www.electronjs.org/docs/latest/api/app#event-window-all-closed.
  Logs: `/tmp/backchat-background-runner-{red,typecheck,build-final,ci,e2e}.log`.

## Runner manager evaluation

- The user asked for a mature manager before further takeover implementation.
  The CLI already has a `service-manager.ts` facade over launchd, systemd user
  services and Windows Task Scheduler. Its current operations install/uninstall;
  safe handoff needs reversible stop/status operations, plus runner-owned
  admission/activity checks. Deleting service definitions is not a handoff.
- RuntimeRoom already rejects a second daemon while the current daemon's
  heartbeat lease is live. Do not introduce another independent process
  supervisor or port-based ownership mechanism without demonstrating a gap in
  those existing authorities. A trial local ownership server and its tests were
  removed before integration; no CLI/SDK exports, installed services or live
  processes were changed by that experiment.
- PM2 is a candidate for a uniform Node process-management API. Its API provides
  lifecycle control, process inspection and IPC, but applications still implement
  graceful shutdown and activity semantics. PM2 startup uses native init systems;
  Windows startup is delegated to an external installer. Adopting it would add a
  manager layer and require migration of existing CLI services, so it is not yet
  selected or installed. Supervisor is Unix-oriented and would add a Python
  service, making it a weaker fit for the desktop platform set.
- An optional clarification asks whether the intended management layer is
  cross-platform processes, task orchestration, or reuse of the existing OpenMA
  runner. Until clarified, retain the accepted architecture and prefer existing
  OpenMA/runtime and platform service mechanisms. Full takeover remains open.
  Sources checked: https://pm2.keymetrics.io/docs/usage/pm2-api/,
  https://pm2.keymetrics.io/docs/usage/startup/,
  https://pm2.keymetrics.io/docs/usage/signals-clean-restart/,
  https://supervisord.org/introduction.html and the installed launchctl manual.

## Multiple installation forms and onion architecture

- The user's subsequent clarification is that OpenMA uses onion architecture
  and supports multiple installation forms. Treat that as the constraint for
  the manager work; no further manager-selection question is needed to proceed.
- Keep distribution separate from process hosting. npm, a package manager,
  a standalone executable and a desktop bundle identify how code arrives;
  foreground execution, a desktop process, a native service, PM2 or a container
  manager identify who supervises a particular host. Neither OS nor executable
  path proves which manager owns the currently connected runner. Multiple
  installations must not create multiple execution owners for one runtime.
- Follow OpenMA ADR 0008 and `createManagedEnvironmentWorkerInstallation`:
  existing runtime/application Ports retain execution policy; outer adapters
  handle platform/provider details; composition loads only the selected
  adapter. The existing cloud Environment Work installation strategies and
  local bridge process supervision are separate concerns, so do not route a
  desktop bridge through an Environment Worker merely to reuse its factory.
- The proposed desktop handoff use case must consume verified host identity,
  admission/activity status and declared management capabilities. Its identity
  must include service/profile/runtime scope and the current host instance;
  an installed-service record is only a discovery hint until verified against
  the live host. Platform manager names, commands and package locations belong
  to the outer adapter. Unknown or externally managed installations remain
  usable through OpenMA but cannot advertise automatic desktop takeover.
- Keep OpenMA's existing execution lease authoritative. A manager can stop or
  restart its process, but cannot establish that a task is idle or transfer
  execution ownership. An explicit handoff must prevent new task admission,
  reject active or preparing work, prevent the previous owner from immediately
  reacquiring execution, confirm release, then acquire from the new host.
  Failure must leave a recoverable state. No running-task migration is added.
- Use existing native service adapters for native installations. PM2 can be an
  optional adapter for installations already supervised by PM2; it is not a
  mandatory daemon for every package. Docker deployments use the deployment's
  own lifecycle controls. Externally operated Workers retain the protocol-only
  boundary in ADR 0008; Backchat does not acquire deployment control implicitly.
- Removed the unreferenced service-control skeleton and six red prototype
  tests before production integration. They assumed native service hosting and
  are not delivered functionality or passing validation. No installed service
  or process was touched. Safe desktop/CLI handoff is still unimplemented.
- References checked: OpenMA `docs/adr/0008-provider-environment-worker-installations.md`,
  `packages/managed-runtime-host/src/environment-worker-installation.ts`,
  https://pm2.keymetrics.io/docs/usage/pm2-api/ and
  https://docs.docker.com/engine/containers/start-containers-automatically/.
  `kardianos/service` provides a cross-platform native-service API for Go;
  adopting it here would require an additional Go host/helper, so it is not
  selected for the existing TypeScript/Electron composition.

## Codex app-server reference research (implementation paused)

- The user clarified that the question is about fusing the OpenMA local daemon
  with Backchat and bundling that daemon in Backchat. They then explicitly
  redirected work to researching mature frameworks, naming the open-source
  Codex app-server as the example. Research is the current next step; do not
  resume a custom manager implementation merely because this goal continues.
- Official OpenAI engineering documentation says desktop/IDE distributions ship
  a tested platform-specific Codex binary and launch an app-server child over
  bidirectional stdio JSON-RPC. This supports bundling one service implementation;
  it does not by itself prove automatic reuse of any independently running
  desktop/CLI instance. Source:
  https://openai.com/index/unlocking-the-codex-harness/.
- Local read-only evidence: installed `codex-cli 0.154.0`; `app-server --help`
  offers stdio, Unix socket, WebSocket and no-listener modes. `daemon --help`
  offers bootstrap/start/restart/stop/version and remote-control toggles.
  `app-server proxy --help` describes forwarding stdio to an existing control
  socket. Only help/version commands ran; no Codex daemon was started or changed.
- Source examined at OpenAI commit `b0af519c39766c173191fc39b341808619b51c74`:
  `codex-rs/app-server-daemon/src/backend/mod.rs` exposes only `BackendKind::Pid`.
  The crate uses Tokio, libc, windows-sys and Codex protocol/transport/install
  libraries. Its built-in daemon backend is its own implementation, not PM2,
  Supervisor or a launchd/systemd service-manager adapter. This conclusion is
  scoped to the inspected open-source daemon, not all internals of Desktop.
- `backend/pid.rs` stores process creation time with PID, serializes startup
  through reservation locks, verifies stale records, and implements graceful
  stop with a force deadline. `backend/windows.rs` uses Win32 handles and file
  locks, with process-identity checks across termination. `src/lib.rs` probes
  the control socket before starting, returns AlreadyRunning for an existing
  server, and refuses stop/restart for a reachable server outside its management.
  The daemon owns installation selection and updater coordination separately.
  These are useful concrete reference behaviors; they are not yet OpenMA features.
- The full app-server has direct dependencies on Codex core and many Codex
  subsystems. It is not established as a generic injectable multi-agent daemon
  framework. Reusing its architecture, extracting its lifecycle layer, and
  embedding Codex itself are distinct options to evaluate before more code.
- Before the research correction, a partial shared connection extraction was
  made in OpenMA's managed-agents-runtime and consumed by a CLI adapter. Its
  nine lifecycle tests and one real loopback WebSocket routing/reconnect test
  pass, and CLI typecheck passes. Backchat still uses its old connection loop;
  the newly added silent-link test is intentionally red (one socket instead of
  a reconnect). This is unfinished work, not a fused daemon or delivered batch.
  No Backchat artifact sync, embedded child process, local daemon discovery,
  IPC control protocol, or takeover was implemented. Production edits paused.
  Logs: `/tmp/openma-daemon-connection-{red,green}.log`,
  `/tmp/openma-daemon-client-{red,green}.log`,
  `/tmp/openma-daemon-cli-typecheck.log`,
  `/tmp/backchat-daemon-connection-red.log`.

## Daemon ownership implementation and session recovery (2026-09-15)

- This section supersedes the research pause above. The complete local session
  transcript records the user's acceptance of "who hosts it owns shutdown" and
  the subsequent implementation. Task API summaries omitted these later turns.
- Backchat reuses a verified existing runtime through OpenMA and records
  `hosting: external`; disabling the runner, quitting or signing out only ends
  its observation. An offline external host is not automatically taken over.
  If no existing host is available, Backchat runs its own bridge and stops that
  bridge when it exits. Closing windows preserves the previously implemented
  background-runner behavior.
- Saved credentials are checked against account/workspace authorization and
  machine/runtime identity. Online discovery uses heartbeat freshness. A host
  that loses the initial execution-lease race before becoming online switches
  to external observation; an active host does not transfer ownership this way.
- Desktop and CLI now import the shared daemon connection from
  `@openma/common/local-runtime`.
  Shared connection code does not constitute a standalone daemon artifact.
- The previous session completed typechecks, the curated desktop CI suite
  (361 tests), and three Electron scenarios covering account/runner recovery,
  cloud restart and external daemon ownership. Evidence remains in
  `/tmp/backchat-daemon-ownership-{ci,e2e,final-types}.log`.
  During recovery, the runner and bridge suites were rerun successfully
  (20 tests): `/tmp/openma-inherited-runner-tests.log`.
- Remaining: package and embed the independent daemon implementation, define
  its local control/compatibility boundary and verify the packaged application
  without a sibling checkout. Existing-host reuse currently goes through the
  OpenMA service; it does not establish a local IPC attachment or version
  compatibility handshake. Do not describe the full daemon integration as done.
- Changes remain uncommitted. Preserve the existing multi-feature working tree;
  do not repeat the completed ownership implementation or return to framework
  selection without a new reason.

## Embeddable daemon lifecycle increment (2026-09-15)

- Continued from the accepted ownership rule. The recommended delivery sequence
  is recorded in `docs/openma-daemon-embedding.md`: reusable lifecycle, execution
  parity, authenticated local attachment, then a pinned bundled process artifact.
  CLI and desktop currently have different session adapters, so substituting the
  current CLI bundle would bypass desktop project/permission/output behavior.
- Added OpenMA runtime `DaemonHost` and integrated it into the CLI daemon.
  Owned sessions drain before transport release; concurrent stops share one
  result, explicit force escalation disposes owned sessions, and drain failure
  triggers cleanup. OS signals, PID discovery and process exit remain CLI concerns.
  This library neither discovers nor shuts down externally owned daemons.
- A real CLI SessionManager integration test exposed admission of new turns on
  retained sessions during drain. Fixed that in the existing shared session
  host, including a recheck after asynchronous lease retention. Existing active
  and completed turn IDs retain their prior idempotency behavior.
- Validation: runtime package 42 tests and CLI package 19 tests pass, including
  the real session-manager drain test. CLI and root typechecks pass, CLI bundle
  builds, and the built CLI `--help` smoke check passes. Logs are
  `/tmp/openma-daemon-host-{runtime-tests,cli-tests,cli-types,root-types,cli-build,cli-smoke}.log`.
  No installed daemon, service, desktop execution entrypoint or deployed server
  was replaced. Full daemon packaging and desktop execution parity remain open.

## Integration boundary correction (2026-09-15)

- The user identifies the overlap as OMA daemon ingress/egress. Adopt that as
  the shared boundary. Backchat and standalone OMA retain their respective
  execution hosts; merging executors or achieving whole-host parity is not
  required to integrate them.
- `docs/openma-daemon-embedding.md` now supersedes its earlier execution-host
  unification and local-RPC plan. Share transport and protocol handling, supply
  execution/storage/project adapters, and preserve host-owned completion.
  Approval request/reply correlation and output ACK/replay are part of this
  bidirectional boundary, not a reason to move Backchat's UI or databases.
- No vscode-jsonrpc dependency or new local RPC protocol is introduced. The
  CLI shutdown helper and drain admission fix remain existing changes; they do
  not dictate Backchat's architecture. This correction changes documentation
  only; production code has not been reorganized around a new executor.

## Accepted local/tenant session model (2026-09-15)

- User confirmed two user-facing session categories: local and tenant-owned.
  Execution location is independent; tenant tasks on a local runner remain
  tenant tasks. CLI profile is configuration, not a required desktop category.
- Tenant tasks retain their OMA session identity and scope across viewing,
  continuation and tenant switching. Use existing service/account/workspace
  identity fields; do not infer ownership from `target.kind` or local cwd.
- The current `OpenmaTask` scope and `SessionRow.openma` association already
  provide a representation for this distinction; no storage migration or new
  profile abstraction was introduced by this design confirmation.
- Local sessions remain local by default. Explicit publication to a tenant,
  including history import and subsequent synchronization, remains unimplemented
  follow-on scope. Do not claim it works or turn imported history into prompts.
- Canonical design: `docs/openma-daemon-embedding.md`. Next implementation work
  should align session selection/creation with this ownership distinction and
  preserve the existing daemon ingress/egress integration boundary.


## Tenant sidebar and scoped access implemented (2026-09-15)

- All authorized tenant groups appear above Local and start collapsed. Multiple
  groups can remain expanded; each owns its new-chat entry, pinned rows and task
  rows. Local stays expanded by default and retains the existing project/pair/
  pinned/chat structure. Existing disclosure, typography and spacing are reused.
- New chat inside a tenant fetches that tenant's catalog and pins the draft's
  tenant and execution target. Available cloud and runner environments use the
  same target builder. No global workspace switch or local duplicate execution
  is performed. Tenant drafts do not silently become local when access is lost.
- Account connections accept an explicit service/account/tenant scope and reject
  unauthorized or expired scopes. Task operations resolve the stored task scope;
  catalog/list/refresh also accept an optional scope. Global list and search span
  authorized tenants. Tokens remain in main. The settings workspace selection
  still scopes runner/project settings, independently of task viewing.
- Each tenant refreshes independently with cached rows, loading/empty states and
  retry. Selection changes preserve observations. Logout, credential changes or
  tenant expiration stop affected observers and remove unauthorized renderer
  rows. Delayed create/rename/catalog/file results recheck access before returning.
- Regression coverage includes two tenants with identical remote session IDs,
  tenant-specific credentials, cross-tenant continuation, scope rejection,
  independent expiry, live subscription retention across selection changes,
  logout during creation, draft pruning and real Electron default disclosure /
  placement / continuation / new-chat routing. Existing cloud restart, runner
  project and independent daemon lifecycle scenarios remain covered.
- Validation: 51 CI suites / 364 tests; 26 sidebar tests; TypeScript checks and
  production build. Electron scenario validation includes openma-tenants,
  openma-cloud, openma-account and openma-daemon-ownership. Screenshots are under
  artifacts/tenant-sidebar. Impeccable detector returned no findings and the
  finish reviewer returned ship for this bounded sidebar extension; no design
  system files required changes.
- This change does not implement publishing local history into a tenant or
  reorganize either execution host. The ingress/egress boundary remains intact.

## Reproducible integration push (2026-09-16)

The desktop dependency and integration changes are now prepared independently of
local shared-library links. See `openma-push-verification.md` for dependency pins,
the service-side counterpart, clean-worktree validation and the bounded fixes
found by expanded regression tests. Unrelated original working-tree changes are
preserved; publication uses dedicated branches rather than changing main.


## Shared common runtime and live continuation (2026-09-16)

Both applications now pin `@openma/common` to `80fdc31e7a3d8dc8be325896ecc310a053c57af6`.
The copied `packages/openma-runtime` snapshot is removed. The common package owns
ACP session execution, daemon transport/shutdown, Work lease management, the
Managed Session control channel and canonical event projection. CLI process
signals/credentials and desktop ownership/project/UI adapters remain outside it.

Desktop sends canonical Session inputs with `Idempotency-Key` in the request
header. Expected canonical event identity is stored locally and reconciled from
history; no unsupported event metadata is sent. Ambiguous writes are not retried
automatically. OpenMA forwards the key into its existing durable acceptance path.
Live testing also exposed and fixed scoped Work ACK authorization and D1's LIKE
pattern limit in input identity lookup.

Verification:
- Common: 352 tests, typecheck and build.
- Desktop: 365 CI tests, typecheck/build, 2 Electron regression scenarios
  (cloud restart and external daemon ownership).
- Real local Workers/D1 API + real local Codex ACP + actual Electron: first turn
  via Work, second turn from the desktop composer, server history verification,
  desktop quit/relaunch, restored output, no duplicate input. This passed with
  an explicitly configured local Work test host. `e2e/openma-common-live.spec.ts`
  is opt-in through OPENMA_LIVE_BASE_URL, OPENMA_LIVE_SESSION_ID and
  OPENMA_LIVE_TEST_TOKEN; its isolated workspace uses tenant-live/user-live.

Limits: the legacy reverse-WebSocket daemon has not been switched to automatic
Work polling. The live test supplies a local preparation adapter and does not
qualify the separate sandbox-native-state adapter, Docker deployment, automatic
worker provisioning or process restart recovery. The sandbox adapter's isolated
Codex state directory failed initialization during a separate probe; that is
not covered by the successful local-host run. Existing daemon discovery and
ownership behavior remain covered by the Electron regression.

## Review corrections (2026-09-16)

- Follow canonical SDK `next_page`; remove numeric history cursor assumptions.
- Establish the live subscription before history catch-up; buffered overlap is
  deduplicated by existing event ID. Do not imply unsupported Last-Event-ID replay.
- Preserve sanitized HTTP status so definitive input rejections release their
  pending local operation for an explicit retry. Ambiguous writes remain blocked
  from automatic resend. Approval retries use the same existing identity.
- Consume input identity from the neutral common protocol entry at
  `85e0b3b6d46f3b8cd219aa2b5a79a1339b5041a0`; runtime entry compatibility is retained.

Validation: 367 desktop CI tests; typecheck/build; two Electron cloud/external
host restart scenarios. Regression cases cover canonical multi-page history,
403 approval retry, and an answer arriving during history catch-up. Common's 353
and OpenMA's 146 application/storage tests pass, including architecture boundaries.
These regressions use controlled service fixtures; the live model/Docker run was
not repeated for this correction.

### Configured live acceptance

The OMA checkout now owns `scripts/live-profiles/backchat-deepseek.example.json`
and `pnpm test:live:backchat <profile.json> [--check]`. It selects the API,
tenant/user, model, ACP command/arguments, credential environment variables and
Backchat checkout explicitly, then runs `e2e/openma-common-live.spec.ts` after
requiring the real first model response. The desktop test accepts
`OPENMA_LIVE_TENANT_ID`, `OPENMA_LIVE_TENANT_NAME`, `OPENMA_LIVE_USER_ID`,
`OPENMA_LIVE_USER_EMAIL` and `OPENMA_LIVE_TIMEOUT_MS`, in addition to its existing
base URL/session/token variables. No production account settings are changed.

The configured DeepSeek ACP 0.4.6 run currently fails before desktop launch
because common requires the unadvertised steering extension. That remains a
real failure; the runner neither skips it nor substitutes Codex.
