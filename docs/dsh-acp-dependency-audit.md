# DSH ACP dependency and semantics audit — 2026-10-25

Evidence: installed `@openma/deepseek-harness-acp@0.4.39` under
`~/.oma/acp/registry/dsh-acp/v_0.4.39_3aa007bf1a5be304/`, npm registry
queries, downloaded DSH 0.2.1-rc.2 packages, official ACP v1 pages and the
Active Subagent Sessions RFD. Static evidence is not live acceptance.

## Version matrix

| Component | Installed / bundled | Published target |
|---|---|---|
| OpenMA DSH ACP | 0.4.39 | latest 0.4.39 |
| ACP SDK | package dependency pinned 1.4.0 | latest 2.0.2 |
| Standalone DSH and subagent runtime | 0.2.0-rc.2 | DSH latest 0.2.1-rc.2, next 0.2.1-rc.3 |
| Cordis in runtime archive | 4.0.4 | latest 4.0.5 |
| Timer in runtime archive | 1.1.6 | latest 1.1.7 |
| Zod | dependency ^4.4.3 | latest 4.6.7 (range permits it) |
| semver / tar / yaml | ^7.8.5 / 7.5.22 / ^2.9.1 | 7.8.5 / 7.5.22 / 2.9.1 |

Do not infer resolved versions from manifest ranges. Do not independently
upgrade each DSH module by `latest`: dsh-subagent's latest tag points at
0.0.1-rc.1 while 0.2.1-rc.2 exists and next points at 0.2.1-rc.3. Use a
coherent runtime matrix. Standalone chooses its locked bundled runtime;
updating an ambient global DSH does not update this executable.

DSH 0.2.1-rc.2 has its own `@deepseek-ai/dsh-acp-app` bundle, depending on
`@deepseek-ai/dsh-acp`. Compare or reuse its capabilities before duplicating
upstream features. Its existence alone does not prove full interoperability.
The new subagent package changes activation/manager APIs and exposes
`drainDescendants`; the adapter already feature-detects the drain API, but
that alone does not establish compatibility of the complete composition.

## Priority semantic findings

Paths below refer to the installed adapter's `dist/bridge.js`.

1. **Final child output lost**: 3058–3065 receives `lastAssistantMessage`,
   while 913–925 emits only identity and stopReason. Child accumulated usage
   is also not exported on end (1075–1095, root-only prompt usage 4214–4215).
   Context-window `used/size` is not a token-consumption ledger.
2. **Child interaction gap**: ownedRecord is root-only (2843–2845);
   child approval falls through at 3757–3759, as does structured elicitation
   at 4402–4407. This is not evidence of automatic permission approval.
3. **Cancel settlement timing**: 4297–4303 resolves the prompt immediately
   after cancel without the normal whenIdle wait (4203–4211). Verify cleanup
   ordering under tools/children; no live race has been reproduced here.
4. **Capability accuracy**: close exists (4287–4295) but is not advertised
   (3821). HTTP MCP support is unconditional although missing mcpClient
   warns and ignores it (4357–4365). MCP mounts are connection-scoped,
   keyed by name, not per-session (4355–4395); empty input does not clear them.
5. **Config handling**: model/preset changes during generation are rejected
   (2732–2735, 3115–3118). Resume/load runtime selection and displayed logged
   config come from different sources (2833–2841, 2890–2899 vs 2707–2716);
   runtime/model mismatch is a risk to test, not a confirmed live defect.

## Standard vs proposal

Official ACP v1 remains the stable baseline. The current **Active** RFD at
https://agentclientprotocol.com/rfds/subagents uses `subagent_update`,
`session_message` and `session_message_chunk`, not the earlier
`subagent_spawned` / `subagent_state_update` draft. SDK 2.0.2 contains the
new association in its v1 **unstable** entry, not its default stable entry.

DSH 0.4.39 instead sends private `_meta.dsh` run lifecycle and child
attribution on the root stream, negotiated with `_meta.subagent-transcript`.
This is not a stable ACP violation; adopting the RFD requires explicit
versioned negotiation and reusable child identity/direct parent/state/message
semantics. Do not rename run finished to idle or infer capability from names.

References: https://agentclientprotocol.com/protocol/v1,
https://agentclientprotocol.com/protocol/v1/session-config-options,
https://agentclientprotocol.com/protocol/v1/tool-calls,
https://agentclientprotocol.com/protocol/v1/cancellation.
