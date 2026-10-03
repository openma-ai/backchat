# Direct managed-agent connections

In **Settings → OpenMA → Agent connections**, choose **OpenMA**, **Claude
Managed Agents**, **OpenAI Agents API**, or **Cursor Cloud Agents** and enter
an API key and base URL.
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
- Cursor Cloud: use `https://api.cursor.com`. The key is a Cursor user API key
  (Basic auth, key as the username). It stays in the main process.

The provider must implement the corresponding **managed agent protocol**.
An endpoint implementing only Chat Completions or Responses is insufficient.
The connection lists existing saved agents. Claude also lists cloud environments;
OpenAI offers no sandbox or an OpenAI-hosted sandbox. Cursor lists models from
`GET /v1/models` plus a Default model, and one Cloud environment. Repository
list calls are cached (at most once a minute and 30 an hour). Create agents and
configure additional provider resources in the provider's own console/API.

A Cursor Cloud thread is one Cloud Agent (`bc-…`) and each turn is one run.
`POST /v1/agents` requires a prompt, so the desktop thread is created locally
and the agent is created on the first message, with a client `bc-<uuid>` for
idempotency. Cursor rejects another run while one is `CREATING` or `RUNNING`
(`409 agent_busy`) and has no steering or server queue. The thread sets
`supportsSteering` to false and reuses the desktop prompt queue: the next
queued message is sent as a new run after the current run ends. Cancel is
terminal; continuing starts a new run. Titles stay on the desktop task because
v1 has no rename API. The thread shows the pushed branch and pull request from
the run `git` vendor event. Inside a project, a new thread defaults to that
folder's git remote and current branch; both can be edited before the first
message and are fixed after that. Pool and machine workers are not offered.

Open a tenant and select **New chat** to pick its agent and environment. Message,
interrupt, rename, tool-result replies, history recovery, and remote files use
that tenant's credentials. Removing a connection removes its credentials and
access from the desktop; it does not delete remote sessions.

OpenMA user API keys can also authorize the local runner: enabling **Connect
this machine** obtains a one-time code using the key, exchanges it for a machine
credential, and saves the configuration without a browser handoff. Tenant-only
keys can use cloud resources but cannot claim a user-owned runner.

## Implementation

`DirectAgentRuntime` uses the official Anthropic and OpenAI SDKs, and HTTPS for
Cursor Cloud Agents API v1. Claude events pass through
`@openma/common/protocol/managed`. OpenAI events pass through
`@openma/common/protocol/openai-agents`. Cursor run SSE passes through
`@openma/common/protocol/cursor-cloud`. Backchat does not build those canonical
events itself. All three are replayed by `@openma/common/agent-ui` in the
existing chat surface. Unknown provider events remain vendor records.
`@openma/common` v0.7.3 also keeps `NodeSpawner` from installing `SIGHUP`,
`SIGINT`, or `SIGTERM` listeners in the Electron main process, so Backchat's
quit confirmation still runs and agent children are reaped on process exit.

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

`direct-agent-runtime.test.ts`, `cursor-cloud-runtime.test.ts`,
`cursor-cloud-tasks.test.ts`, `openma-account.test.ts`, and
`direct-task-projection.test.ts` cover SDK transport, Cursor create/stream/queue
behavior, credentials, tenant isolation, and shared event replay.
`e2e/direct-agents.spec.ts` uses local HTTP fixtures with the real SDKs and
Electron app to configure the OpenMA, Claude, and OpenAI connection modes,
chat, exit, restore, and continue without duplicate submission. These checks do
not require or claim validation against a live third-party account.
