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
