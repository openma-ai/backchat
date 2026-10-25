# GUI bug tracker — 2026-10-23

All items below come from user feedback in the current conversation. Work them
one at a time: reproduce → failing regression → minimal fix → verify → update
this record. Do not describe an item as resolved before its verification gate.
Preserve unrelated uncommitted changes.

## 1. Sidebar status slot and ancestor aggregation

**Feedback:** Running spinner sits left of the final slot. Add completed-unread,
error and approval states and propagate them to workspace/project.

**State:** Implemented; verification completed in this worktree, not committed.

**Evidence:** sidebar-activity.spec.ts passed; Sidebar/sidebar-activity and
related surface tests passed (80 tests at the preceding checkpoint); renderer
TypeScript check and Electron build passed. Electron screenshots are under
`test-results/sidebar-activity-activity--23f57-through-collapsed-ancestors/`.

**Caveat:** Broader session-store suite had two unrelated exact-object failures
about extra segmentId fields; no changes were made to those assertions.

## 2. Three composer footer selectors differ

**Feedback:** “底部这三个按钮的行为样式完全不同，尤其是弹出的 select，请以第二个为标准。”

**State:** Core selector unification implemented and verified; follow-up edge-case tests remain.

**Reference:** The second/project picker is authoritative for trigger appearance,
open/hover/focus state, popover positioning and shell, density, search, selection,
scrolling and keyboard behavior. Preserve target locking and workspace creation.

**Findings:** Runtime used DropdownMenu, no search, different density and no
open surface. Project/workspace used Popover with separately authored styling.

**Current partial patch:** ComposerPickerMenu shared presentation; runtime
composer variant moved to Popover; workspace shell shares the project helper.
Sidebar runtime variant intentionally remains independent. Component tests and renderer typecheck passed; Electron search/keyboard/Escape/focus and computed surface parity passed. Runtime/workspace screenshots visually inspected. Workspace create action remains visible during search by design.

**Gate:** Passing rendered-component tests, renderer typecheck, Electron checks
of all three controls (mouse + keyboard + search + open states), screenshots.

## 3. Steer user message differs from ordinary message

**Feedback:** “这个 steer 的消息感觉和普通消息逻辑不一致。”

**State:** Implemented across common + Backchat; focused component, live/replay and Electron rich-image checks passed. Remaining release/integration caveats are listed below.

**Findings:** ChatTurn supplies renderPrompt but not renderUserInput. SDK falls
back to a smaller muted bubble with no ordinary prompt actions.

**Required:** Reuse normal user-message presentation, applicable copy/edit and
long-text behavior, attachments, actual timestamp, and delivery/error feedback.
Check both live projection and history replay. Never turn injected steering into
a separate prompt turn for visual convenience (I2/I11).

**Gate:** Regression for shared presentation + ordering, attachments/actions,
live/replay parity, Electron screenshot and interaction checks.

## 4. Missing thinking fallback after interim output

**Feedback:** “这个状态应该补一个兜底的思考中。”

**State:** Implemented in common; component and Electron lifecycle regression passed.

**Findings:** SDK suppresses its fallback once any content has appeared, even
when the prompt is still unresolved and no specific activity is visibly running.

**Required:** Show Thinking… when the authoritative turn is running with no
more specific in-progress feedback. Avoid duplicates beside actual running
tools/thoughts; remove on terminal state, not on first assistant text (I1/I3).

**Gate:** Text-only/interim, completed-tool, live-thought/tool, send-pending,
failed/cancelled/completed cases; Electron verification of the reported scenario.

## 5. Text stretches into a line during collapse

**Feedback:** “收起的时候，动画不对，文字会被拉成一条长线。”

**State:** Shared-container fix implemented; common state tests and Electron intermediate geometry/reduced-motion checks passed.

**Scope:** Process/reasoning collapse. Inspect both native collapsible wrapper
and inherited SDK CSS before changing shared primitives.

**Required:** Height clipping/fade without text deformation or width reflow;
open/close must work mid-animation and under reduced motion.

**Gate:** Capture actual intermediate animation frames and compare text width,
transform and layout; verify expanded/collapsed endpoints and reduced motion.

## 6. Active goal missing from GUI

**Feedback:** “gui 的状态上没看到 goal。”

**State:** Investigation started; no fix yet.

**Known:** create_goal returned an active host goal. That does not prove ACP
session_info_update carried it or the renderer displayed it. Existing Codex
adapter reads _meta.goal and _meta.codex.goal; the GUI uses SessionRow.goal.

**Required:** Trace actual structured runtime updates → adapter → store → GUI.
Do not fabricate a goal from assistant prose, tool names or transcript scanning.
Consult official ACP v1 extensibility and local lifecycle rules I6/I7/I10.
If the running harness does not publish the goal, identify the correct upstream
boundary rather than pretending a renderer-only patch can recover missing data.

**Gate:** Real event evidence, targeted regression at the failing boundary,
GUI demonstration of create/update/terminal behavior with no stale goal.

## Working order

2 → 3 → 4 → 5 → 6. Item 1 is already verified; recheck its relevant tests before
final integration. A blocked item gets a concrete cause and next action recorded;
otherwise complete and verify the current item before moving to the next.

## 7. GUI appears stopped while work/status should remain legible

**Feedback:** “你还在吗，画面似乎停止了？” / “刚刚是不是也是 bug？”

**State:** Report recorded; not yet confirmed as a renderer freeze.

**Observed evidence:** The specific Electron picker test had already exited with
an assertion failure (workspace's persistent Create action remains in search).
No live test process was still waiting when its handle was inspected. This
alone does not establish that the user's main window froze or the ACP turn was
still running at that moment.

**Investigation:** Distinguish an actually stalled render/event stream from an
unresolved turn with no visible activity indicator (item 4), and from missing
follow-up scheduling after a settled turn. Correlate prompt completion, pending
tool status and renderer state; never infer a live turn from assistant prose.

**Gate:** Reproduce the reported interval with timestamped lifecycle evidence;
verify the UI shows Thinking… only while actually running and never leaves a
false live state after completion. Assess jointly with items 4 and 6.

## Screenshot follow-up: duplicate thinking and steered image placeholders

New user screenshots add explicit acceptance cases to items 3 and 4:

- **Item 4:** The same visible running turn displays two “思考中…” rows, one
  muted and one bold. A thinking fallback must have a single owner and appear
  at most once per unresolved turn. Inspect thought-event rendering and SDK
  empty-output fallback together; adding another unconditional status is not
  an acceptable fix. Screenshot evidence establishes duplication, not its cause.
- **Item 3:** An image sent while steering renders as literal
  `[Attached image: …pasted-image.png]` inside a user bubble, without the actual
  image preview. Preserve structured attachments through steering delivery,
  active-turn projection and replay. Render image previews using the ordinary
  message attachment path. Do not hide the placeholder unless the corresponding
  attachment is actually present; never reconstruct file paths from prose.

Required regression scenarios: image-only steer, text + image steer, multiple
images, history replay, missing/unavailable image, and a running turn containing
steering input plus thought activity with exactly one live thinking indicator.

## 8. Selecting assistant text does not offer annotation

**Feedback:** “这里选中没有出现 annotation。” Screenshot selects ordinary
assistant prose inside the expanded process transcript while tools are active.

**State:** Implemented in Backchat; reproduced-before/fixed-after Electron annotation flow passed.

**Required:** Text selection in interim/process assistant messages must expose
the same annotation affordance as ordinary assistant messages where supported.
Inspect selection root ownership, streaming/settled markdown boundaries,
popover placement/clipping and focus handling. Preserve the actual selection
and source-message identity; do not attach annotations to a different turn.

**Gate:** Reproduce on the reported process text; test ordinary answer and
interim text, running and settled states, annotation creation and composer chip,
keyboard and pointer selection; verify no toolbar for tool chrome or inputs.

## Shared-package ownership

User explicitly notes that some fixes belong in openma-common. For every item,
locate the owning layer before implementation. Shared chat projection, built-in
thinking fallback, process-collapse primitives or steering attachment data that
are owned by @openma/common must be fixed in its source repository, with shared
package regression tests and a Backchat integration check. Do not directly edit
node_modules or accumulate Backchat CSS/renderer workarounds for common defects.
Preserve provider-specific behavior and check both source worktrees before edits.

## Item 3 implementation checkpoint

- Shared source changed in `../openma-common`: canonical injected input retains
  attachments and source timestamp through parse → reduce → chat-ui projection.
  Its 38 focused common tests pass and the package builds.
- Backchat renderUserInput now uses UserPromptBubble, sharing copy/edit/long-text
  UI and a sent-attachment preview component with ordinary prompts. Preview
  supports persisted file paths after base64 removal and degrades to a file link
  if image loading fails.
- Focused rich-input component and live/replay tests pass. Electron
  `steer-message-consistency.spec.ts` passes, asserting image, timestamp,
  actions and no fabricated standalone steer turn.
- Temporary local dependency link receipt is in `common-local-link.json`.
  Shared changes are not published. Backchat vitest resolves linked packages
  through real paths and inlines common to prevent duplicate React instances.
- Still to verify before closing item 3: image-only/multiple image cases,
  missing-image interaction, queued/failed sending feedback, and final integrated
  screenshots after the persisted-path preview fix.
- Broader existing canonical store tests currently have five unrelated
  background-work representation mismatches with this source common checkout;
  the targeted steering live/replay regression passes. Do not mask failures.

### Latest verification

- Footer + injected image Electron scenarios passed together (2/2).
- Strengthened image test now checks actual decode and 64px natural width, not
  merely presence of an img element; rerun passed.
- Image-only placeholder removal regression passed. Multiple-image/file
  rendering coverage added. No prose-derived file-path reconstruction.
- Renderer typecheck passed after shared source linkage.
- Item 4's known failing thinking-fallback regression intentionally remains red
  until its own shared-package fix; it is not part of a claimed all-green suite.

## Item 4 verification checkpoint

- Common now owns a single thinking fallback for an unresolved prompt when no
  actual pending/in-progress tool or streaming thought is present. Existing
  paragraph text cannot terminate liveness. Finished tools are no longer
  projected as still running merely because they are the last event.
- Common focused suites: 45 passed. Backchat ChatTurn: 55 passed.
- Electron `thinking-fallback.spec.ts`: passed across interim text → live tool
  → completed tool → live thought → authoritative turn completion. It asserts
  fallback count 1/0 at each boundary and captures screenshots.
- This resolves the reported empty-looking waiting tail and duplicate generic
  fallback in tested cases; it does not establish that every reported perceived
  freeze has the same cause (item 7 still requires event correlation).

## Item 5 verification checkpoint

Common process activity previously lived outside ChatReasoningContent and used
its own hidden/display transition while extras used a different height wrapper.
It now lives inside the same shared height/opacity clipping container. Paragraph
layout remains full-width while the outer height clips; nested state stays mounted.
Common collapse/components suites passed (45 tests). Electron geometry regression
passed, checking unchanged paragraph width/height, transform:none, closed clip
height 0 and reduced-motion toggles. Intermediate screenshot retained.

## Item 6 actual event evidence

Read-only inspection of the current session's persisted event stream found 7
session_info_update payloads and 0 _meta.goal / _meta.codex.goal snapshots, while
2 tool lifecycle records referenced create_goal. Thus the renderer had no
structured goal snapshot to display. This is upstream of SessionRow.goal, not
proof of a missing goal badge. Continue investigating codex-acp notification
forwarding; do not derive a goal from the tool transcript as a workaround.

### Goal evidence correction

The earlier count of two records containing `create_goal` was a substring search
and included shell commands/document text, NOT verified goal-tool lifecycle
records. A stricter structured tool-name/title check found no native goal tool
identity in the inspected ACP session. Retain only the valid finding: no goal
snapshot was delivered there. The host goal tool's thread identity has not yet
been correlated with the ACP session's runtime thread. Do not attribute this to
a confirmed adapter defect until that correlation and upstream notification
capture are available. The installed codex-acp 2.2.2 does contain handlers for
thread/goal/updated and thread/goal/cleared, as does its source checkout.

## Item 8 verification checkpoint

Reproduced missing annotation on live process prose. Backchat selection controller
had rejected the entire running response. Assistant prose now has an explicit
selection surface, and selections must stay inside the same prose surface and
source turn; tool chrome and editable fields are excluded. Electron reproduced
failure before the fix, then passed selection → toolbar → Add to prompt →
annotation marker + composer annotation chip. Focused renderer suites: 71 passed.

## Item 7 live-window evidence (2026-10-23)

Read the actual installed app via accessibility, not the E2E window. Its URL is
`file:///Applications/Backchat.app/Contents/Resources/app.asar/out/renderer/index.html`.
The source edits and rebuilt `out/` used by E2E are NOT installed into this app.
Thus passing E2E never established that the user's current window contains fixes.
The live window reports Running and shows a running `mcp.cua_repl.js` activity.
The getApp inspection itself took 581.44 seconds, a concrete tool wait causing
an additional silent interval; avoid further slow full-tree reads of this window.
Do not reload/restart the user's active session without explicit agreement.
A deployment/relaunch handoff is still needed before claiming the live app fixed.

### Goal identity confirmed

The active host goal thread ID exactly matches the persisted ACP session ID for
the current Backchat chat. Read-only native `goals_1.sqlite` confirms an active
goal for that same thread (not an unrelated host goal). The duplicate
`~/.codex/sqlite/goals_1.sqlite` has no matching row, so storage/config ownership
also needs checking. The UI still received no goal snapshot; adapter handlers
exist. No synthetic GUI goal or SQL polling workaround has been added.

### Goal runtime correlation, second source

Native Codex rollout for the same thread confirms a real `create_goal` function
call at 2026-10-23T04:35:17Z. Native goals DB confirms active state. This is not
an unrelated host thread. Neither the ACP log nor rollout contains a structured
goal-update event. Existing adapter maps thread/goal/updated into _meta.goal, but
current runtime emission/forwarding remains unverified. Renderer fallback from
tool results remains explicitly prohibited; next upstream diagnostic must
capture app-server goal notifications or query the official thread/goal/get API
without perturbing the active prompt. No repair is yet claimed.


## Latest integrated status

- Backchat focused GUI unit suites: 138 passed; renderer typecheck passed.
- Six GUI regression scenarios passed in one serial Electron run. Separate
  structured goal snapshot lifecycle test passed (active → paused → complete),
  proving GUI rendering works when the protocol snapshot actually arrives.
- Common: 103 tests passed across ACP projection, parser, UI, collapse state,
  presentation and session surfaces; shared-package typecheck passed.
- Goal upstream notification delivery remains unresolved; no live app restart
  or installation replacement has been performed. Working tree modifications
  and local common linkage are not a deployed application release.

## 9. Hide internal Guardian automatic reviews from ordinary activity

**Feedback:** “这个得隐藏吧？怪怪的。”

**State:** Implemented in source; adapter/render regressions and renderer typecheck passed. Integrated Electron verification in progress.

Hide routine Codex Guardian automatic-review lifecycle from user-facing tool and
thought summaries. Preserve the canonical event log and real permission asks.
Keep actionable denials/failures visible. Identify via structured native review
payload/adapter metadata, not title string or fabricated completion. Add live and
replay regression, including a normal tool named Guardian Review (must remain).

## Queue/steer running-state regression reproduced and fixed in source

A new test reproduced a late queue snapshot resurrecting a completed parent
while retaining an already-injected steer ID. Provider snapshots could also
resurrect completed prompts, or idle could overwrite a still-unresolved prompt.
Renderer now preserves authoritative terminal prompt state (I1), excludes injected
steer IDs from independent running ownership (I2/I11), and derives filtered queue
rows and IDs together (I4). Twelve focused tests and renderer typecheck passed.
An Electron late-queue regression is being run; this is a source fix, not yet an
installed-app update. This reproduction is not proof that every live report had
this exact late snapshot; real traffic still needs causal correlation.


## Guardian verification follow-up

Structured Codex automatic-review payloads are filtered only for normal
in-progress/approved reviews. Denial, timeout, abort, transport failure and genuine
permission asks are retained; neither titles nor tool ID prefixes identify a
review. Canonical events are untouched. Live + settled-history render regression
caught a second defect: client-side cancellation settling caused routine reviews
to reappear in history. Classify the original provider payload before settling.
Adapter + ChatTurn suites: 128 passed; renderer typecheck passed.

Footer supplementary verification passed: computed trigger styles after animation,
shared popover shells, search, arrow keys, Escape/focus return, and existing target
locking. Rich-image steer Electron regression passed. These remain worktree
changes using the local common link, not an installed application update.

## Integrated verification — 2026-10-23 15:31 CST

- Seven focused renderer suites: **147 tests passed**; renderer typecheck passed.
- Fresh Electron build, eight isolated GUI scenarios: **8 passed** (18.2s):
  footer selector parity, structured goal lifecycle, Guardian review visibility,
  collapse geometry, running-prose annotations, sidebar status aggregation,
  rich-image steer rendering, thinking fallback/late-queue terminal boundary.
- Guardian ordinary in-progress/approved reviews remain hidden; denied review
  stays visible; a normal tool named Guardian Review remains visible. Replay
  regression classifies original provider payload before client settling.
- `git diff --check` passed.
- No installation/restart of `/Applications/Backchat.app` occurred. Common source
  changes are still supplied through the documented temporary local symlink;
  versioned/reproducible dependency delivery remains outstanding.
- Goal test proves renderer behavior on structured snapshots only. Missing live
  goal notifications remain unresolved upstream; do not mark item 6 fixed.

## Reproducible shared dependency handoff

Added a pnpm patchedDependency and lockfile hash for registry common 0.11.0.
The dist-only patch applies cleanly to an untouched registry package; all 14
changed published files match the sibling build. Tests now ran against that
patched registry copy, not sibling source: 61 targeted tests, both TS projects,
Electron build and footer/steer GUI scenarios passed. Additional steer send-state
regression passed. Footer Enter selection + retained checkmark passed for all
three controls. Full reinstall remains unperformed; pnpm requested purging the
existing layout, which was not authorized. Patch README records reproduction.
Frozen lockfile supply-chain validation also passed (1426 entries, pnpm 11.24.0).
Original footer/steer source goal completed; this does not close the entire bug
tracker or claim the installed app contains these edits.

## Unified follow-up — native goal synchronization

Read-only `thread/goal/get` against the same native thread returned the actual
completed objective (Codex 0.153.4), proving durable native state is readable
through the official interface even when this ACP connection received no goal
snapshot. Added an upstream regression in codex-acp-auth-fix: it failed because
ordinary prompt handling never refreshed that state. The adapter now reconciles
via `thread/goal/get` at prompt entry/exit and opaque native MCP/dynamic tool
completion, deduplicating snapshots and preserving revision/session guards.
No tool-name matching, transcript scanning, SQLite polling or fabricated goal.
114 adapter tests + TypeScript passed, including still-running native-tool
completion and cross-connection durable-goal recovery. Runtime delivery and
packaged integration remain to be verified; not deployed to the active shim.

Full-suite execution exposed a destructive test-environment interaction:
Homepage.test invokes pnpm run under CI; automatic dependency verification
started an install while Vitest was running and removed modules. Stopped the
specific test processes and restored frozen dependencies. Added
pnpm_config_verify_deps_before_run=false to the spawned website build. Registry
common patchedDependency is now actually installed (no temporary sibling link).

## Unified batch verification checkpoint

- Clean frozen installation now applied common patch through pnpm itself.
- Relevant source suites: 156 tests passed; web/node type checks passed.
- Fresh build: eight GUI scenarios passed again in 17s.
- Upstream codex-acp complete test run: 611 passed, 26 skipped; typecheck/build passed.
- Local ad-hoc application built at release/0.0.18/mac-arm64/Backchat.app;
  no changes to the running /Applications app or current agent shim.
- Broader Backchat run: 2334 passed, 26 failed across 15 files. Several failures
  are pre-existing source-contract/shape drift; no blanket full-suite-green claim.
  Actual full output is /tmp/backchat-full-unsandboxed.log. Two affected old
  thinking/runtime-selector contracts were updated to the intentional new behavior
  and passed separately. Do not relabel the unrelated failures as repaired.
- Real multi-connection write attempts are rejected by native single-writer
  ownership, so notification absence is NOT proof that arbitrary cross-writer
  mutation is supported. Goal refresh uses read-only official APIs; still-running
  tool and prompt-boundary behavior is covered by upstream regressions.

## Real goal and packaged-runtime verification

Real transport smoke passed on isolated native thread
01a167d1-6406-7a10-afce-5f0a8c1aaea3: seed minimal prompt, write paused native goal,
close writer, load via fixed ACP adapter, observe _meta.goal paused, clear through
advertised _session/goal, observe null. Original user thread was not mutated.
This demonstrates real persistence → adapter → structured goal transport;
Electron separately verifies structured metadata → GUI. Native opaque-tool refresh
while a prompt remains running is covered by the upstream regression.
Packaged-runtime isolated dependency verification passed for the built App.
Current session still runs old installed app/adapter; no hot replacement claimed.

## 10. Running session incorrectly disables approval/model configuration

User screenshot highlights the disabled approval and run/model selectors during
an active prompt. Official ACP v1 Session Config Options explicitly permits
changes while idle OR generating a response. Added Electron regression first;
it failed at disabled Approve for me. Composer passed `disabled=running` to both
PermissionModeChip and SessionRunChip even though main-process setConfigOption
already allows active prompts. Replaced those guards with the actual composer
unavailable flag; inline config controls now respect the same unavailable flag.
I1/I6/I7: config changes neither end the active prompt nor fabricate confirmed
config values. Keep provider-returned complete configOptions authoritative.
Verification in progress for mode/model/reasoning while Stop remains visible.

Item 10 verification: Electron regression went red at disabled approval trigger
before fix, then passed changing mode/model/thought level and asserting all three
IPC parameters while the original turn remained running and Stop stayed visible.
Related controls/auth/actions/state suites: 27 passed; renderer typecheck/build
passed. Short configuration lists intentionally omit search and focus their
Command root; keyboard selection was used for nested model/reasoning lists.
Mouse traversal of the existing nested dropdown exposed pointer interception;
not claimed fixed by this running-state guard change. Track separately if it
reproduces outside the test's bottom-edge geometry. Candidate App being rebuilt.

## 11. Workspace loading label wraps below its spinner

Screenshot reproduced with a delayed workspaces:list IPC: loading span computed
`display:block`, not shared inline-flex. Footer style selector only covered
buttons. Extend baseline geometry to the non-interactive loading status; reuse
icon track and explicitly keep nowrap. Electron regression failed before fix.

## 12. Sidebar project collapse has a final extra layout step

AnimatedCollapse unmounted the subtree on ANY own transitionend, including
opacity before height finished. Regression reproduces early opacity event
removing the body. Unmount only on the height transition (opacity for explicitly
lightweight mode); fallback timer retained. Inner flow-root prevents list top
margins escaping the animated shell and disappearing on final child unmount.
Unit red captured; browser intermediate/end geometry verification in progress.

Items 11/12 verified: 8 component tests, typecheck/build passed. Four Electron
checks passed (loading geometry, real 220ms project-close animation, sidebar
status, footer parity). Collapse test explicitly overrides fixture-wide zero
transition duration; captures positive intermediate heights and asserts parent
height is unchanged from shell-zero through child unmount. Loading regression
asserts nowrap, icon/text center alignment and height matching adjacent project.
Candidate at the same release path is being rebuilt; no live-app restart.

## 13. Long conversations crash with missing StickToBottom context

User screenshot shows the app error boundary. New isolated Electron regression
reproduced the exact error when the transcript grows past 16 turns and switches
to ChatVirtualConversation. Common virtual path intentionally provides its own
ChatScrollAnchorContext, not StickToBottom; four host consumers still read the
small-list-only third-party context (HistoryPager, FollowOnSend, timeline,
ToolRow). Expose the shared common scroll-anchor hook and migrate every host
consumer. Do not disable virtualization or swallow context exceptions. Failing
18-turn reproduction captured; fix/build/real scrolling verification in progress.

Item 13 verified: exact 18-turn crash reproduced before fix. After common bridge
migration, 72 host tests, 45 common tests, renderer types/build passed. Three
Electron checks passed (long virtual transcript, annotation, steer); additional
long-list interaction opens process + tool details without context error and
scrolls to the final turn. No direct useStickToBottomContext consumers remain in
host conversation components. Patched dependency/lock updated and installed via
pnpm. Candidate rebuild in progress.

## 14. Injected user messages are hidden inside process disclosure

Screenshot shows a user image within the Worked process region. Prior steer
work unified the bubble but retained shared turn renderer's process ownership.
Regression reproduced missing user input when completed process is collapsed.
Common now partitions process activity at user_input boundaries: activity →
visible user message → activity, all within the same canonical turn. Supplemental
process panels render only once. Do not extract all inputs to the top/end or
fabricate independent prompt turns. UI regression in progress, common 41 tests
passed after initial change; final package awaits integrated verification.

Item 14 integrated verification: 58 host tests, renderer types/build and four
Electron cases passed. Collapsed-process regression asserts activity/input/
activity DOM ordering, user text remains visible with every process closed, and
there is still only one parent turn. Rich-image input regression additionally
checks its preview is outside every process disclosure. Long virtual transcript
and thinking lifecycle remain passing. Candidate rebuild in progress.

## 15. Image attachments need real previews and composer viewer

Composer thumbnails were 44px and not interactive. Sent image classification
required kind=image, so historical file-kind PNGs rendered as long filename
chips. Add raster MIME/extension classification, shared image viewer for draft
and sent uploads, 128×96 composer preview (contain, no screenshot cropping),
larger bounded sent preview, keyboard-close/focus restoration and retained
separate remove action. Failed/missing images retain bounded file access.

## 16. Diagnostic warning creates phantom running transcript

User supplied sess-qh7nswwc. Read-only canonical event evidence: prompt
turn-o66un1hr completed at 12:22:41Z; diagnostic warning arrived at 12:30:38Z with
empty turn_id. Live reducer fabricated a running turn with id=""; session stayed
ready, hence sidebar and transcript diverged. Regression reproduced phantom turn.
I1/I11 fix routes ownerless session text to notice only in live AND replay;
never infer a prompt boundary or classify arbitrary warning text by substring.
Original warning stays in canonical event log. Image changes retained in same
batch. Verification in progress.

## 17. Remove ancestor status propagation (user changed requirement)

User explicitly requests no workspace/project status aggregation. Removed their
activity fields, reductions and indicators; session-local status remains.
Regression assertions updated to require structural folders contain no activity.

## 18. Pi selected-model mismatch and auth recovery

Read-only Pi native session evidence for sess-j4dlgyh9: initial model_change at
12:01:31Z was openai-codex/gpt-6.1-sol, assistant error at 12:01:34Z refresh-token
401; at 12:02:58Z model_change successfully became
anthropic-proxy/claude-opus-5-5. No evidence Opus credentials failed. Two host
seams: draft submission only sent sparse overrides (could omit displayed model),
and config failure was swallowed before prompt. Send full displayed initial
config and fail closed on config rejection. Confirmed model changes after auth
failure clear only the old retry gate, set auth unknown (not configured), permit
retry; another auth error reinstates the block. Native Pi switch succeeded yet
host retained old auth failure; recovery regression added. Initial user click
history is unavailable, so do not claim a fully traced cause before live test.

## 19. Footer open-state wash and touching popovers

User screenshots show open-state wash differs from hover, popover bottom touches
trigger, and adjacent active surfaces are clipped. Regression requires same
hover/open color, no clip-path, and positive popover/trigger separation.

## 20. Sending flicker and poor earlier-history loading — research before animation

User rejected naive fly-up animation and requested mature library review.
Reviewed official AI Elements Conversation/Message docs and source, plus
assistant-ui Thread/Scroll anchor docs. AI Elements Message has no default
fly-up transform; its Conversation delegates smooth following to one
StickToBottom owner. assistant-ui pins only while already at bottom and releases
when the reader scrolls up. Stable component identities are explicitly advised.

Current concrete conflicting owners: common ChatTranscriptInitialScroll runs on
every tailTurnId and writes scrollTop then instant scrollToBottom; Backchat
FollowOnSend separately smooth-scrolls the same tail; HistoryPager also pins
initial layout. ChatTurn additionally remounts AgentUITurnView on live/settled
key changes. HistoryPager restores prepends via whole scrollHeight delta and
three scheduled writes, which can conflict with virtualizer end anchoring and
late image measurement. Do not paper over these with bubble translation/fade.
Next gate: reproducible scroll trace, one scroll owner, stable message DOM across
send/first token/completion, prepend visible-row anchor preserved through late
image/font layout and virtual threshold; reduced-motion and history reopening.
Sources: https://elements.ai-sdk.dev/components/conversation ;
https://github.com/vercel/ai-elements/blob/main/packages/elements/src/conversation.tsx ;
https://github.com/vercel/ai-elements/blob/main/packages/elements/src/message.tsx ;
https://www.assistant-ui.com/elements/thread ;
https://www.assistant-ui.com/elements/scroll-anchor .

### 20 — implementation and bounded verification (22:50 CST)
- Reproduced live→terminal prompt DOM replacement in Electron: node-identity
  assertion failed at completion. Replaced live/settled keyed remount with
  common's opt-in `collapseProcessOnComplete`; prompt remains the same node and
  the work disclosure still closes. Regression now passes.
- Common initial landing runs only once after hydration, no longer writes an
  instant scroll on each appended tail in competition with FollowOnSend.
- History paging captures the current visible turn/paragraph immediately before
  publishing the fetched page, restores its viewport offset (including remapped
  replay row IDs), and releases scheduled correction on wheel/touch input.
  Height delta is fallback only when the original content cannot be found.
- Fixed the history E2E fixture to actually exceed the 1600-row page threshold
  and include complete prompt boundaries; older 800-row fixture never paged.
- Verification: 4 anchor unit cases, 56 ChatTurn cases, Electron DOM continuity,
  virtual-threshold regression and earlier-page viewport (<5px drift) pass.
- Does not claim all older issues fixed. Structured retry renderer remains a
  separate unfinished follow-up; existing draft test currently blocks full web
  typecheck (missing turn-retry-state module). No app restart or install done.

Candidate rebuilt successfully at `release/0.0.18/mac-arm64/Backchat.app`;
`verify-packaged-runtime.mjs` exited 0. Focused final units: 63 cases including
latest pre-commit capture ordering; Electron 3/3. Not installed or launched.

## 22. Sidebar track continuity — 2026-10-24
User screenshot flags the previous sidebar column alignment drifting. Measured
project label→child icon alignment remains exact (x=42 in Electron); Codex and
Pi glyph bounds fit the shared 14px slot. Concrete deviation: workspace branch
text used inline 11px glyph + gap-1 (4px) rather than shared 14px track +6px gap,
putting text 5px left of chat text. Regression failed with measured 5px delta.
Workspace branch now uses sidebar-row-icon wrapper and shared column-gap token,
keeping the branch glyph at 11px while reserving the same icon track as chats.
Electron rail regression passes; 68 Sidebar unit cases pass; build passes.
Screenshot: test-results/sidebar-track-continuity-p-b3a02-lyph-stays-inside-its-track/sidebar-track-continuity.png.
Source/out updated only; running app and candidate package not replaced yet.

## 23–25. 2026-10-24 visual follow-ups
- Corrected item22 interpretation: primary request was native red traffic-light center aligned with depth-0 sidebar icon rail at every UI zoom. Replaced obsolete hardcoded 30px center with actual renderer geometry, preserving fractional coordinates and removing rail collapse transform. Native coordinates round only once after zoom conversion; stale zoom results ignored, bounded initial mount wait, zoom-changed sync. Electron 75/90/100/110/125/150/175/200 percent rail check passes within 0.5 DIP.
- Primary sidebar nav/session/coordinator ink now fg-muted; structural project/workspace remains quieter. Selected/error colors preserved. Electron computed color test passes.
- Sent images now composer-like 128x96 object-contain thumbnails, flex-wrap row with 8px gaps. Two-image row regression failed before implementation, now passes including full viewer, Esc and focus restoration.
- 75 focused unit cases pass; Electron visual batch 4/4 before fractional-coordinate refinement; final native zoom regression passes. Renderer builds pass.
- Disk nearly full (about 500MiB free): did NOT rebuild candidate app. Running app and previous release package unchanged.

### 2026-10-25 candidate handoff correction
User reopened old candidate and saw none of items23–25. Disk now has 24GiB
available; rebuilding from current source. Electron regression rerun: native
traffic-light eight zoom levels + collapsed focus stability, primary sidebar ink,
and two-image horizontal row/full viewer all pass (3/3). Added diagnostic
`verify-visual-candidate.mjs` to byte-compare every out/ file with app.asar and
check all three requested changes are present before handing out the same path.
Candidate completed 2026-10-25 10:55 CST. 328 build files match app.asar
byte-for-byte; measured rail / primary ink / compact thumbnails checks pass;
isolated packaged-runtime verifier exits0. app.asar SHA256:
2540fa29aa63722a057ce6b36a0f8d9e9cbc20cd1f0abff2f66d7887f09fbb46.
No installed application or running window was restarted.

## 26. Waiting status belongs to current process-group header — 2026-10-25
User screenshot: completed commands retain historical run-summary header while
an independent Thinking row appears below. Fixed shared UI projection: when the
prompt is unresolved, no running tool/live thought exists, no answer follows,
and final activity is a tool/thought, the final group header owns Thinking.
Single completed tools get the same disclosure owner; earlier groups retain
historical summaries. No extra tail status. New tool/native thought takes over;
terminal prompt restores completed summary and removes live fallback. For text-
only waiting without a process group, retain one tail fallback.
Electron regression red: fallback was outside group. Green: one fallback in
header, survives manual expansion, removed during tool activity/native thought,
removed on terminal; stale queue cannot restart it. 60 focused units + 3 Electron
regressions pass, including steer visibility and stable prompt DOM.
Source in sibling common, compiled dist carried by patched dependency/lock hash.

## 27–28. Release follow-ups: thinking shimmer and transcript navigation
- Restored ShimmerText for live fallback and native thinking labels after the
  process-header move. Existing reduced-motion rule keeps labels static.
  Regression first failed missing shimmer class; 7 focused unit cases pass.
- ConversationTimeline previously searched only mounted DOM, so a virtualized
  target silently failed. Shared scroll bridge now exposes scrollToTurn(id),
  backed by virtualizer.scrollToIndex. Explicit navigation releases initial
  HistoryPager settling before scrolling; no fixed delay required.
- Real Electron regression uses 18 actual input rows and clicks first history
  option while offscreen, then returns to tail and opens tool detail. Before
  fix target never mounted; after fix passes, including immediate navigation.
- 2026-10-25 release check: node/web typechecks pass after moving unfinished
  structured-retry test draft into docs/tasks/deferred-tests (not implemented,
  not hidden as a passing feature). CI lane 848/848 and scripts63/63 passed at
  pre-navigation checkpoint; full tests had known baseline failures. Formal
  release not published. Rerun final gate after these follow-ups.

## 29–30. Shimmer visibility and steer fallback ownership
- User reports shimmer too subtle and missing on standalone native thought.
  Atomic ThoughtEventRow still passed plain strings; unified with ShimmerText,
  widened presentation prop to ReactNode. Stronger narrow fg-subtle/fg sweep,
  1.6s linear, inline-block; reduced-motion retains readable static label.
- User reports injected steer leaves wait above latest input. Shared projection
  now treats a latest user_input as feedback ownership boundary: previous group
  goes historical, fallback follows accepted input immediately. Does not create
  a new prompt or treat queued inputs as injected. Running tools still own their
  truthful activity feedback. Input-tail no longer borrows stale live thought.
- Before fix Electron fallback ancestor assertion fails (inside previous group).
  After fix passes below-input geometry. 9 shimmer/thinking unit cases and 3
  Electron cases pass (steer, thought animation incl reduced-motion, navigation).

## 31. Late ownerless tool completion creates phantom running turn
Actual local trace sess-ewt815xh: seq224775 turn.completed owns turn-2c9mfgy5;
seq224776 tool.progress and seq224777 tool.completed have empty turn_id but
stable tool_call_id call_kVxIU4XAMbWQlYIykzzCSOf4 from the original turn.
Live renderer previously created turn id="" with running status; replay dropped
the patch, leaving live/replay inconsistent. Resolve ownerless tool patches by
unique existing tool identity within the same session. Never guess active turn;
unmatched/ambiguous patches remain in canonical log without fabricating a turn.
Existing completed status remains completed. Regression red creates extra blank
turn; green9/9 boundary tests include live and canonical replay routing.
Earlier commands-summary screenshot may be the same missed completion ownership;
do not override genuinely in-progress tool state based on screenshot or silence.
The attempted session_info metadata regression passes unchanged, so metadata was
not confirmed as cause. No new candidate packaged yet for this fix.

## 32. Source correlation and annotation-only injected inputs
- Root source confirmed: #handleOutOfBandSessionUpdate fallback sends empty turn
  id after prompt ends. #sendAcpSessionEvent now remembers call ID -> originating
  turn for the lifetime of the native session and uses it for late tool patches.
  Main regression failed empty id before fix; passes original id after fix.
- Annotation-only injected input lost structured annotations in common parser,
  timeline and AgentUIUserInputItem; host explicitly discarded them as well.
  Preserved structured arrays through all stages. UserPromptBubble owns the
  shared expandable annotation strip for both ordinary and injected inputs;
  hides generated count text only with actual annotations present. Removed
  separate parent-before-turn strip to avoid duplicate/detached presentation.
- 176 focused tests pass; Electron3/3 (steer ordering, annotation-only reference
  opens actual quoted text/comment, late empty tool patch creates no phantom).
  Main/web typechecks pass. Current installed/running app unchanged.

## 33. Mirror conversation navigation onto left edge
User requests timeline ticks mirrored left. Wrapper left12 instead of right12,
normal row flex, ticks align-start, hit padding mirrored to right; list opens
inward on right without mirroring text. Electron red showed rail far from left;
green asserts left-edge geometry, list opens right, offscreen target navigation
and subsequent tail/tool expansion all pass. Build passes. Not packaged yet.

## 34. Steer sections must not duplicate turn-level status
User screenshot shows identical Working132s above and below injected input.
Root: processSections.map rendered a full turn-header for every activity slice,
although every slice reads the same parent turn/status/elapsed/processOpen.
Keep the single visible turn status/control on first activity slice; subsequent
slices are continuation content with shared parent expansion state. Inputs stay
outside all folds. No new turn, timer reset or terminal inference added.
Electron regression failed2 headers before, passes1 while running and settled;
sole trigger opens/closes both sections and input remains visible. Other4-case
Electron pass covers input/annotation/thinking/stable prompt DOM. Focused61 units
and web typecheck pass. Source/out only; not packaged yet.

## 35. Renderer automatic recovery (release remains blocked on root cause)
Main-owned recovery waits500ms after abnormal renderer exit, reloads UI only;
max2 automatic attempts per5min; 20s load timeout offers native reload dialog.
Clean exit/window close cancels pending timers. No session/prompt resend APIs in
controller. Electron forcefullyCrashRenderer reports killed/exit2; treating all
non-clean exits as recoverable verified actual new renderer DOM comes back,
same main PID, existing fake ACP prompt remains busy, then explicit cancel works.
5 controller unit cases + real Electron crash E2E pass. Native SIGTRAP root cause
not diagnosed/fixed; no claim that automatic reload resolves it. Summary under
artifacts/renderer-crash-2026-10-25. Not packaged yet.

## 36. Local sidebar scope is not composer execution-target selection
Remote choice changed local section title because Sidebar used active-session
RuntimeLocationControl. Replaced with fixed localized Local heading and saved
local-only disclosure; remote tenant sections remain outside collapse, composer
retains execution-location picker. Click folds local projects/chats instead of
opening account/resource menu.14 focused unit cases, main/web typecheck and build
pass (includes5 recovery cases). Current running app unchanged.

## 37. Remove redundant header menu; keep agent permission wording verbatim
User requests removing top sidebar ellipsis containing only New section and
using agent-returned permission names/descriptions without localization mapping.
Removed header-only dropdown (section-level create entry remains); removed
fixed mode-value label/description translation table from SessionModeControl.
Existing configModeOptionPresentation preserves agent name/description, with
existing duplicate-description suppression; icons/tone not modified.
Regression assertions first failed old translated chip and redundant menu.

## 38. Named think tool presentation (Compact conversation)
Recorded event seq238140 has kind=think/title=Compact conversation/status=in_progress,
with no name or adapter metadata. Official ACP Tool Calls defines think as the
broad reasoning/planning category, not a context-compaction discriminator.
Do not classify by title. Named think tools now retain the agent's title without
an extra Thinking prefix, both in group summaries and atomic tool rows. Running
atomic title uses existing shimmer. Cancellation/denial keep their lifecycle copy.
Two regression tests failed first; 82 focused tests and web typecheck pass.
Adapter's sibling source has contextCompaction metadata, but actual recorded
traffic does not: dedicated compaction lifecycle presentation remains pending
adapter distribution. No running/installed app restarted or package published.

### Correction: standard compaction, not AIR metadata
Latest registry codex-acp is 2.2.2 (download inspected, not installed). Its
CodexSessionCompactions emits standard compaction_update when the client
advertises session.compaction. AIR tool metadata is a separate compatibility
path and MUST NOT be used as Backchat's compaction contract. Removed the
experimental AIR-only implementation/tests. package.json is unchanged.
Official source: https://agentclientprotocol.com/protocol/v1/prompt-turn
Required pending work: standard ID-addressed compaction entity projection,
summary chunk/replacement/null patch semantics, capability advertisement after
support is implemented, adapter dependency update and live/replay verification.

## 39. Whitespace thoughts must not become historical reasoning rows
Recorded agent_thought_chunk events include text="\n\n" with message IDs.
These created empty historical reasoning rows and misleading duration labels.
Filter whitespace-only thinking items at the host presentation boundary, not
raw events or stream chunks, so later real content is retained. Live outer
thinking fallback remains separate. Regression failed first then passed for
running and completed turns; existing real-thought-history tests retained.
This host fix does not yet correct shared common's thought-duration calculation.

## 40. Standard ACP compaction implementation (supersedes item 38 investigation)
Implemented official compaction_update + compaction_summary_chunk, not AIR
metadata/title recognition. Common reducer retains first-seen chronological
position and patches one entity by compactionId; preserves unknown statuses,
summary blocks, null/omitted metadata/error semantics, replacement and append.
Chat UI has a dedicated compaction slot, not a synthetic tool or thought.
Active compaction suppresses the ordinary waiting fallback; completed compaction
does not end the ACP prompt (I1). Text summaries expand as Markdown; all source
summary blocks remain preserved. Client declares session.compaction only with
this implementation present. Host replay now retains canonical raw compaction
records rather than dropping them (real Electron reload regression caught it).

Dependencies: codex-acp 2.2.2, ACP SDK 1.9.0 (shared-runtime override plus local
ACP package minimum). SDK update is essential: common previously resolved 1.3.0.
No AIR capability declaration or private metadata handler. Common dist patch
rebuilt/reinstalled reproducibly; public common version unchanged.

Verification: common 80 focused tests; Electron 2 tests passed, including genuine
SDK agent/client notification transport, capability negotiation, DB persistence,
reload and retained summary. Fake harness, not a paid production Codex run.
Main/web typechecks and production build pass. Expanded host event-store suite
has 5 unrelated-background/subagent assertion failures (212 passed overall),
so no full-suite-green claim. Current installed/running app unchanged; no release.
