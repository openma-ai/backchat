# Backchat Agent Instructions

## ACP Protocol Work

- For any ACP-related implementation, review, debugging, or explanation, first
  verify the behavior against the official Agent Client Protocol documentation:
  https://agentclientprotocol.com/protocol/v1
- Do not rely on memory, local assumptions, or older implementation behavior
  for ACP protocol semantics. If the official docs and local code disagree,
  call out the discrepancy and prefer the official docs unless the task is
  explicitly about maintaining backwards compatibility.
- Use the official docs to confirm method names, request/response shapes,
  notification names, lifecycle timing, and migration guidance before editing
  ACP-facing code.
- For session-level choices such as models, modes, and reasoning/thought level,
  consult the Session Config Options documentation first:
  https://agentclientprotocol.com/protocol/v1/session-config-options
  Prefer `configOptions` and `session/set_config_option` when the docs say they
  supersede older APIs.
- If the official docs cannot be reached, state that clearly before proceeding.
  Local SDK schema and existing code may be used as secondary evidence, but do
  not present that as confirmed ACP behavior.
- When a needed behavior is absent from the official protocol fields, inspect
  and preserve ACP `_meta` extension data before inventing side channels.
  The v1 docs define `_meta` as the compatibility-safe place for implementation
  details; adapters often namespace real capabilities there (for example
  `claudeCode.parentToolUseId`). Prefer adapter `_meta` over transcript/log
  scanning or natural-language result parsing.
- Native subagent support is intentionally scoped to the two adapters Backchat
  cares about first: Claude Code (CC / `claude-acp`, especially
  `_meta.claudeCode.*`) and Codex (`codex-acp`, including its native
  multi-agent tool/events). Do not infer subagent semantics from similarly
  named tools in unrelated ACP agents without explicit evidence.
- Keep the three agent/session levels distinct:
  1. Native subagent: created by the provider/agent runtime, surfaced from
     structured ACP events or adapter `_meta`; the GUI must not create these.
  2. Side chat: a GUI-created side session subordinate to the current main
     session. Use `session/fork` for context inheritance when the agent
     advertises it, and keep the parent link while it lives in the side rail.
  3. Fork: a fully independent main session that inherited context. Promoting
     a side chat clears its side-parent link and makes it this level.
