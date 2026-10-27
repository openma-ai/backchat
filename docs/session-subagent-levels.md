# Session / Subagent Levels

Backchat keeps three levels separate:

1. Native subagent
   - Created by the provider runtime, not by Backchat GUI.
   - Current supported providers: Codex (`codex-acp`) and Claude Code
     (`claude-acp` / CC).
   - Evidence source must be structured runtime data: ACP events, native Codex
     collab events, or adapter `_meta` fields such as
     `_meta.claudeCode.parentToolUseId`.
   - Do not parse natural-language result text like `agentId: ...` as the
     primary identifier.

2. Side chat
   - Created by Backchat GUI in the right rail.
   - Stored as a side session with `sideKind: "chat"` and a `sideParent` link.
   - If `forkSupport()` from `@openma/common` is not `"none"`, Backchat
     starts the side chat through ACP `session/fork` so it inherits context.
     Message fork is a separate action and only runs when the level is
     `"message"`.
   - It remains subordinate while it lives in the side rail.

3. Fork
   - A fully independent main session that inherited context.
   - Promoting a side chat clears `sideParent` and moves it to `kind: "main"`.

## Current Evidence

- ACP fork plumbing is covered by `packages/acp/src/session.test.ts`,
  `packages/acp/src/fork-point-contract.test.ts`, and
  `src/main/session-manager.test.ts`. The main process calls `forkSupport()`
  and sends `fork_support` plus `supports_session_fork` (`level !== "none"`).
  A message fork also passes `SessionOptions.forkPoint`. The runtime
  deep-merges that into `session/fork` `_meta` and does not fall back to a
  whole-session fork when the agent rejects the point.
- Renderer side-chat behavior is covered by
  `src/renderer/src/lib/session-store.test.ts`. Those tests prove a side chat
  carries `sideParent`, and promotion clears that link.
- GUI creation is guarded by `src/main/session-level-gui-contract.test.ts`.
  The right rail can create `Side chat`; it must not expose native subagent
  creation actions.
- Native runtime event normalization is covered by
  `src/renderer/src/lib/native-agent-events.test.ts`:
  - Codex `collab_tool_call` and `spawn_agent` / `wait_agent` events become
    native subagent activity.
  - Claude `Task` / `Agent` tool calls become native subagent activity only
    when the parent session is a Claude Code adapter.
  - Plain result text containing `agentId: ...` is not treated as a structured
    child id.
- Local Claude Code transcripts show structured task results can contain
  `toolUseResult.agentId`, `agentType`, and `prompt`. That is useful evidence
  for CC's native model, but Backchat should consume it only if an adapter
  exposes it structurally through ACP / `_meta`, not through transcript
  scanning.
- The dev dependency `@agentclientprotocol/claude-agent-acp@0.55.0` was
  inspected and smoke-tested. Its compiled adapter emits
  `_meta.claudeCode.toolName` for tool calls and
  `_meta.claudeCode.parentToolUseId` for subagent-originated messages/tool
  updates. Those names match Backchat's `reduce-turn` extraction path.
- A real `claude-agent-acp@0.55.0` smoke run is available through
  `pnpm run smoke:claude-acp-meta`. The captured output at
  `test-results/native-agent-experiments/claude-agent-acp-meta-smoke.json`
  showed:
  - `supportsSessionFork: true`
  - Agent/Task updates with `_meta.claudeCode.toolName: "Agent"`
  - a structured async child id in
    `_meta.claudeCode.toolResponse.agentId`
  Backchat treats that structured `_meta` child id as authoritative and keeps
  async-launched Claude subagents in `running` state.
- `pnpm exec tsx scripts/smoke-claude-agent-acp-fork.ts` performs a real
  `session/fork` smoke against `claude-agent-acp@0.55.0`: a parent session is
  asked to remember a random token, a child ACP session is created with
  `forkFromAcpSessionId`, and the child is asked for the token. The latest
  local run returned `parentSupportsSessionFork: true`,
  `childSupportsSessionFork: true`, and `childMentionedToken: true`.
- On July 3, 2026, the ACP registry entry for `claude-acp` reported
  `version: "0.55.0"` with distribution
  `npx @agentclientprotocol/claude-agent-acp@0.55.0`, matching the smoke-tested
  dev dependency.
- A real Codex CLI 0.142.5 run produced structured `collab_tool_call` items
  for `spawn_agent`, `wait`, and `close_agent`; the child id appeared in
  `receiver_thread_ids`, and the child result appeared in
  `agents_states[child_id].message`. The parser supports both bare
  `collab_tool_call` objects and the `item.completed` wrappers used by
  `codex exec --json`; this shape is captured in
  `src/renderer/src/lib/native-agent-events.test.ts`.
- The dev dependency `@agentclientprotocol/codex-acp@1.1.0` was added so the
  Codex ACP native-subagent shape is reproducible in development. A real
  `pnpm run smoke:codex-acp-native` run showed the adapter maps native
  multi-agent activity into ACP `tool_call` / `tool_call_update` events with
  titles `spawnAgent`, `wait`, and `closeAgent`. The child id is in
  `rawInput.receiverThreadIds`; child state/result is in
  `rawInput.agentsStates`; the latest local run captured one child id and
  `CHILD_OK`. Backchat normalizes this camelCase ACP shape too. The same smoke
  reported `supportsSessionFork: false`, so GUI side chats against current
  `codex-acp` should start as subordinate fresh side sessions, not ACP-forked
  sessions.

## Verification Notes

- The full Electron GUI path is covered by a static contract test plus renderer
  screenshots of the right rail: the GUI can create `Side chat`, cannot create
  native subagents, and passes ACP fork parameters only when the active runtime
  advertises session fork support.

## DSH adapter extension (0.4.39)

DSH is now an explicitly supported native-subagent provider as well. This is
not ACP v1 subagent semantics: the installed `@openma/deepseek-harness-acp`
0.4.39 `SessionProjection` publishes its own structured extension:

- `session_info_update._meta.dsh.event = "subagent/lifecycle"` with
  `subagent.{runId,childSessionId,provider,local,state,stopReason?}`.
- Child text, thought and tool updates retain their ordinary ACP shape and
  carry `_meta.dsh.subagent.{childSessionId,parentToolCallId,provider}`.
- The common runtime already advertises `_meta["subagent-transcript"]: true`,
  which enables this child stream in DSH. No launch-tool text parsing is used.

Backchat translates these into canonical WorkItems and child transcript events,
including history replay. Each run uses the adapter's `subagent:<runId>` anchor;
the child session identity remains the durable `childSessionId`. Explicit
`completed`, `error`, and `aborted` endings map to complete, error, and cancelled.
Other endings retain their reason and use unknown rather than claiming success.
The lifecycle notification does not end the parent's prompt (I1/I5).

Scope: current wire consumption, not full DSH parity. The installed adapter's
lifecycle end projection does not forward `lastAssistantMessage`, despite the
runtime supplying it; remote children without streamed content therefore may
have no displayed answer. Nested parent hierarchy, partial-stop presentation,
child usage/plan coverage and direct child control need further work. This
change does not modify or republish the separately maintained DSH adapter.

## Current RFD path: Claude 0.95 and DSH opt-in

Backchat advertises `clientCapabilities.subagents: {}` only for Claude and
DSH. Codex remains on its existing compatibility path pending upstream #655;
no additional AIR-draft adapter is introduced here.

The current Active RFD is not stable ACP v1. It uses `subagent_update`,
child-addressed ordinary updates, and `session_message` upserts/chunks. The
client keeps association metadata (including capabilities and work state)
separate from the displayed latest execution. Idle does not delete identity;
a missing stop reason is not displayed as successful completion. Unsupported
child mutations are not offered, and ordinary prompt input stays disabled.

SDK 2.0.2 removes the old connection classes. A tracked pnpm patch to common
0.11.0 migrates the runtime/probes to the new `/unstable` client builder and
retains outer notification session IDs even without notification metadata.
The patch is applied on clean install; it is not a registry installation edit.
Publish these changes in common and remove the local patch when available.

RFD wire events are retained as versioned `vendor.event` records in namespace
`subagent_sessions` until common owns a canonical association/message schema.
The raw notification context is retained. Replay prefers these scoped records
over the duplicate root-oriented raw projection. Message content uses upsert
and chunk semantics, not assistant-token concatenation; it has a distinct UI
section and retains non-text content. Child config, plan, tool, thought and
message streams do not overwrite the root session's metadata/transcript.

Validation includes actual Claude 0.95 `NativeSubagentRuntime` producer code
against Backchat, shared-runtime SDK wire tests, and deterministic lifecycle,
nullable patch, nested ownership, reuse and replay tests. These are not live
model or Electron end-to-end acceptance. The attempted live Claude smoke was
blocked by its SDK process receiving SIGKILL during setup. No success is
inferred from a mock transcript.

### SDK2 ordering and startup regression coverage

The SDK2 client builder dispatches session notifications independently of RPC
response resolution. Backchat's common compatibility patch delays delivery of
a response until preceding session-update callbacks have completed. This
maintains I1 (prompt response is the boundary) without inferring completion
from queue snapshots or moving output to an arbitrary completed turn.

RFD routing also requires an explicit child association (I11). A missing or
stale root wire session ID alone cannot turn root traffic into child traffic.
Replay does not suppress canonical root content solely because an older build
incorrectly stored a matching RFD vendor record.
