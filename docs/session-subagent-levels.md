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
   - If the active ACP agent advertises `sessionCapabilities.fork`, Backchat
     starts the side chat through ACP `session/fork` so it inherits context.
   - It remains subordinate while it lives in the side rail.

3. Fork
   - A fully independent main session that inherited context.
   - Promoting a side chat clears `sideParent` and moves it to `kind: "main"`.

## Current Evidence

- ACP fork plumbing is covered by `packages/acp/src/session.test.ts` and
  `src/main/session-manager.test.ts`. Those tests prove Backchat passes
  `forkFromAcpSessionId` into the SDK's unstable `session/fork` surface and
  returns `supports_session_fork` to the renderer.
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
