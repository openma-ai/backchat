# OpenMA daemon ingress and egress in Backchat

## Accepted product model: local sessions and tenant sessions

The user accepted this model on 2026-09-15. Session ownership and execution
location are separate dimensions:

| Session ownership | History and continuation | Possible execution |
| --- | --- | --- |
| Local | Backchat owns the local session; no automatic OMA publication | Existing local executor |
| Tenant | An OMA tenant owns the task; Backchat views and continues that same task | Backchat-hosted runner, standalone runner, another runner or cloud environment |

A tenant session executed on this computer is still a tenant session. Selecting
a local execution target must not silently create a local-owned duplicate.
Use service URL, account and tenant ID to resolve authenticated access; preserve
the OMA session ID and its originating scope across UI navigation. Existing
desktop observation and runner execution records may be distinct local records
of the same OMA task, not separate user-visible conversations.

The UI selects local sessions or a tenant's sessions. Login/server selection is
connection setup; CLI `profile` remains a named configuration mechanism, not a
third session category or a separate required desktop selector. Switching the
active tenant does not reassign existing sessions or stop externally hosted work.
One runner can be authorized for multiple tenants; a tenant can use many runners.

The sidebar shows all authorized tenants above Local. Each tenant group starts
collapsed, independently expands, and contains its own new-chat entry, pinned
items and sessions. Local starts expanded and retains projects, pinned chats and
pair chats. A tenant's new-chat entry selects one of that tenant's available
agent/environment combinations; it does not change the global settings selection.
An existing task always resolves credentials from its own service/account/tenant
scope. Changing the settings selection does not interrupt another tenant's view.

For an associated tenant task, submit input once through OMA, execute at its
assigned host, and return output through daemon egress. Backchat renders that
same task and must not also execute the UI submission directly. Callback replies,
interrupts and output delivery retain task/turn/event identities for correlation.
Opening or continuing a task in Backchat does not migrate its execution host.

An explicit **Publish to tenant** operation may associate an existing local
session with a tenant task and import its history. This is accepted follow-on
scope, not delivered functionality: define a supported historical import
contract and idempotent association before implementation. Historical entries
must never be replayed as executable input. Do not expose a working-looking
publish action until that end-to-end path is implemented and verified.

## Scope (revised 2026-09-15)

The shared integration boundary is the OpenMA daemon's ingress and egress.
Backchat retains its execution host. The standalone CLI daemon retains its
execution host. Sharing the boundary does not require merging SessionManagers,
project stores, approval UIs or local task state.

This decision supersedes the earlier plan to turn Backchat into a client of a
single extracted execution host, require execution parity, add a local control
RPC layer and switch all desktop execution to a bundled daemon process.
Those steps are not prerequisites of this integration.

```text
OpenMA service
  -> shared daemon ingress
     -> host adapter
        -> Backchat SessionManager OR standalone daemon SessionManager
     <- host events and callback requests
  <- shared daemon egress
```

Backchat local UI continues to call its existing session interfaces. Local-only
work does not go through OpenMA's remote transport.

## Shared boundary

- Connection authentication, greeting/capabilities, heartbeat and reconnect.
- Ingress command decoding, tenant/session/turn scoping and routing to host
  operations. Existing commands include start, prompt, cancel and dispose.
- Egress event encoding and delivery: ready, output, completion, errors and
  disposal. Callback/permission requests travel out; their correlated replies
  travel back in. The integration is bidirectional, not merely a text stream.
- Delivery sequencing, acknowledgements, replay and duplicate handling belong
  to the protocol boundary where supported. Storage is supplied by an adapter;
  sharing policy does not require sharing a database.

The shared boundary must preserve host-authoritative completion and must not
become a second execution scheduler. Keep the existing OpenMA wire protocol;
no additional RPC protocol or vscode-jsonrpc dependency is required here.

## Host-owned behavior

Backchat owns its local SessionManager, ACP children, project/directory mapping,
local persistence, UI projection and permission interaction. Its adapter maps
OpenMA identities and events onto those existing interfaces. Standalone OMA
provides its own execution adapter. Differences in host implementation are
expected; advertise only capabilities the adapter actually supports.

Keep the accepted ownership rule: the manager of an execution host owns its
shutdown. Connecting another client does not transfer ownership. Backchat
observes an external runtime through OpenMA and does not stop it on Quit or
logout. Window close preserves a Backchat-owned background runner; explicit
Quit stops the owned host. A separate process is an optional placement decision,
not a requirement imposed by sharing ingress/egress.

## Existing code and next work

- Both compositions already consume `DaemonConnection` and session-kernel
  codecs. Backchat's `OmaBridgeClient` contains richer output replay and approval
  correlation; CLI's `daemon-client` currently routes the basic commands.
- Extract reusable protocol policy from those adapters into OpenMA-owned code,
  consuming it in both hosts. Keep Backchat-specific event projection and
  directory resolution in the desktop adapter.
- Use the same protocol conformance cases for both adapters: tenant isolation,
  command delivery, callback correlation, real completion, lost acknowledgements
  and reconnect without resubmitting native input. Unsupported capabilities
  must remain explicit rather than being silently claimed.
- Version and distribute the resulting shared boundary code reproducibly.
  Do not replace Backchat's executor with the standalone CLI to share it.
- The preceding `DaemonHost` increment is a CLI-owned shutdown helper. Backchat
  need not adopt it or reorganize its execution around it. Its drain admission
  fix remains independently useful.

## Acceptance

Remote commands reach the intended host/session once; output and callbacks
return with correct scope; reconnection obeys delivery guarantees; local desktop
work remains local; shutdown affects only the owned host. Existing runner
ownership, approval and reconnect tests remain regression gates.
