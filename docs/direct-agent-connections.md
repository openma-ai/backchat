# Direct managed-agent connections

In **Settings → OpenMA → Agent connections**, choose **OpenMA**, **Claude
Managed Agents**, or **OpenAI Agents API** and enter an API key and base URL.
The tenant name is optional; OpenMA discovers the tenant name, while third-party
connections default to the server hostname. Each saved
connection appears as its own sidebar tenant, alongside OpenMA workspaces.
Third-party services need no OpenMA login, identity endpoint, or runner registration.
An OpenMA API key discovers its real tenant through `/v1/oma/me`; other
memberships are not authorized merely because they appear in that response.

- OpenMA: use the server root, e.g. `https://app.openma.dev` (`/v1` is also accepted).
- Claude: use the API root, e.g. `https://api.anthropic.com`.
- OpenAI: use the SDK base URL, e.g. `https://api.openai.com/v1`.
- OpenMA's OpenAI-compatible service: use `https://your-server/openai/v1`.

The provider must implement the corresponding **managed agent protocol**.
An endpoint implementing only Chat Completions or Responses is insufficient.
The connection lists existing saved agents. Claude also lists cloud environments;
OpenAI offers no sandbox or an OpenAI-hosted sandbox. Create agents and configure
additional provider resources in the provider's own console/API.

Open a tenant and select **New chat** to pick its agent and environment. Message,
interrupt, rename, tool-result replies, history recovery, and remote files use
that tenant's credentials. Removing a connection removes its credentials and
access from the desktop; it does not delete remote sessions.

OpenMA user API keys can also authorize the local runner: enabling **Connect
this machine** obtains a one-time code using the key, exchanges it for a machine
credential, and saves the configuration without a browser handoff. Tenant-only
keys can use cloud resources but cannot claim a user-owned runner.

## Implementation

`DirectAgentRuntime` uses the official Anthropic and OpenAI SDKs. Claude events
pass through `@openma/common/protocol/managed`. OpenAI events terminate at the
canonical `@openma/common/session-events/openma` boundary. Both are replayed by
`@openma/common/agent-ui` in the existing chat surface. Unknown OpenAI event types
remain vendor records; provider-specific subagent controls are not exposed here.

Live subscriptions open before history is fetched. Reconnect restores history
without resending instructions; losing an input acknowledgement leaves an
explicit uncertain operation. OpenAI submissions carry an idempotency key.
Claude's public input contract has no operation metadata echo, so successful
submissions rely on provider history for display; uncertain submissions are not
silently retried or matched by text.

API keys stay in the main process and are not returned to the renderer. They
use the existing account file with directory mode `0700` and file mode `0600`.
Connection identity includes the protocol, endpoint, and a credential digest,
so different keys on the same endpoint cannot share cached sessions accidentally.

## Verification

`direct-agent-runtime.test.ts`, `openma-account.test.ts`, and
`direct-task-projection.test.ts` cover SDK transport, credentials, tenant
isolation, and shared event replay. `e2e/direct-agents.spec.ts` uses local HTTP
fixtures with the real SDKs and Electron app to configure all three connection modes,
chat, exit, restore, and continue without duplicate submission. These checks do
not require or claim validation against a live third-party account.
