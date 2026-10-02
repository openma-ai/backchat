# Backchat local control CLI

An external coordinator running on the same machine can drive Backchat without
clicking through the GUI. The Electron main process listens on a Unix domain
socket (a named pipe on Windows) and the `backchat` command speaks HTTP-shaped
JSON to it. Handlers call the same project, workspace, session, and work
services the GUI uses, so CLI-created sessions show up in the sidebar and stay
live.

There is no TCP port.

## Install

Starting Backchat installs a `backchat` launcher into the first writable
directory among `~/.local/bin` and the desktop CLI paths in
`src/main/cli-path.ts` (`/opt/homebrew/bin`, `/usr/local/bin`, and
`/opt/local/bin` on macOS). The launcher runs `node` against the CLI shipped
with the app (`src/cli/backchat.mjs`, copied into the packaged app's
resources). Add `~/.local/bin` to `PATH` if it is not already there.

The socket is `<storage root>/control.sock`. The storage root is `~/.oma`, or
`$BACKCHAT_HOME` when `BACKCHAT_TEST_HOOKS=1`. Override the socket with
`BACKCHAT_CONTROL_SOCK`. If that path would be longer than 100 bytes (the
macOS Unix-socket limit), both the app and the CLI use
`/tmp/backchat-<hash>.sock` instead so startup cannot fail with
`ENAMETOOLONG`. A failure to bind the socket is logged and does not stop the
GUI.

If the app is not running, every command exits `2` and prints where it looked.

## Caller identity

`--client <name>` or `BACKCHAT_CLIENT` names the external coordinator (for
example `cursor killer`). Backchat does not give that caller a second
coordinator page or sidebar row. The built-in Project coordinator is unchanged.

The name is stored on sessions and on tasks submitted with `work submit`.
`session list` and `work list` / `work status` / `work view` then return only
that client's records. Omit `--client` (and `BACKCHAT_CLIENT`) to see every
record.

In the GUI, a CLI session stays in its normal project or workspace list, with
its real title. A small icon on the row has the tooltip `Started by cursor
killer`. The same icon sits on that client's tasks in the project Threads
panel. There is no in-app chat for the external coordinator.

`work submit` from a client does not need the built-in coordinator to be
configured, and it does not send the task to that coordinator. Built-in work,
submitted without `--client`, still uses the project coordinator and still
requires that setup.

### Coordinator workflow

```bash
export BACKCHAT_CLIENT="cursor killer"
backchat project create --name hilo --source ~/repo-a --source ~/repo-b
backchat workspace create --project <id> --branch feature/coord --base main
backchat session start --workspace <id> --agent cursor --approve auto-read
backchat session send <session> "Summarize the layout." --stream --timeout 120
backchat session pending <session>
backchat session respond <session> <requestId> <option>
backchat session status <session>
backchat session transcript <session> --since <cursor>
backchat session send <session> "Focus on the API."    # steer a live thread
backchat session cancel <session>
backchat work submit --project <id> --text "Review the branch"
backchat work list --project <id>
backchat work view --project <id> --task <taskId>
backchat work steer --project <id> --task <taskId> --text "Skip generated files"
backchat work transcript --project <id> --task <taskId>
backchat work cancel --project <id> --task <taskId>
```

`session send` steers a live thread. `work steer` appends a follow-up on a
submitted task. `work cancel` marks that task cancelled. Neither command
deletes the other client's work.

## Commands

```bash
backchat project list
backchat project show <id>
backchat project create --name <name> --source <dir> [--source <dir> ...]
backchat project remove <id> [--force]

backchat workspace list [--project <id>]
backchat workspace show <id>
backchat workspace create --project <id> --branch <name> [--base <ref>]
backchat workspace remove <id> [--force]

backchat session list [--workspace <id>] [--project <id>]
backchat session start --workspace <id> --agent <agentId> \
  [--root <dir>] [--dir <dir> ...] [--prompt <text>] \
  [--approve ask|auto-read|auto-all]
backchat session send <id> <message> [--wait] [--stream] [--timeout <sec>]
backchat session status <id>
backchat session transcript <id> [--since <cursor>]
backchat session cancel <id>
backchat session pending <id>
backchat session respond <id> <requestId> <option>

backchat work submit --project <id> --text <text> [--type message|delegate|steer|cancel|complete] [--worker <id>]
backchat work list --project <id>
backchat work view --project <id> [--task <id>]
backchat work steer --project <id> --task <id> --text <text>
backchat work cancel --project <id> --task <id> [--text <text>]
backchat work transcript --project <id> --task <id>
backchat work status [<projectId>]
backchat work view --project <id>
backchat work goal --project <id> --thread <id> [--status active|paused] [--objective <text>] [--clear]
```

Every command accepts `--json`. Machine-readable output goes to stdout. With
`--json`, failures are a JSON document on stdout as well as a non-zero exit.

`--agent cursor` launches `cursor-agent acp` when that binary is on `PATH`. If
Backchat has installed the managed ACP shim, that shim is used instead. Enable
Cursor in Settings → Agents the same way as the other ACP agents so the GUI
picker offers it.

`project create` with the same name and the same source directories returns
the existing project (`created: false`). A source directory that does not
exist is exit `5`. `project remove` deletes the project record. Managed
workspaces are removed with it, and a dirty checkout is refused unless
`--force` is set. Creating or removing a project refreshes the sidebar.

A managed workspace is one git worktree per source repository, all on the same
branch name. If that branch already exists, the worktree checks it out.
`--base` is the start point for a new branch. When the branch already exists,
`--base` must be an ancestor of that branch or the command fails. A `--base`
ref that does not resolve names that ref in the error. Creating the same branch
for the same project again exits `5` with `Workspace already exists for branch
…`, not a raw git error.

Agents that accept additional workspace directories get one root per
repository. If the agent reports that it does not support additional workspace
directories, the session runs in the directory that contains those checkouts
and the first prompt lists the repository paths. If the checkouts do not share
a parent, startup fails with that agent's error. The same fallback is used
when a session is started from the GUI.

`workspace show` returns each repository's worktree path, branch, HEAD sha, and
dirty state. `workspace remove` deletes the managed worktrees and refuses when
they have uncommitted changes unless `--force` is set. It deletes a branch only
when this workspace created that branch; a branch that already existed and was
checked out is left in the repository. The live project checkout is never
deleted.

`session start --approve auto-read` auto-approves only tool calls whose ACP
kind is `read`, `search`, or `think`. `edit`, `write`, `delete`, `move`,
`execute`, and any unknown kind stay in `session pending`. A title or name
that mentions edit, write, delete, move, or shell is not treated as
read-only. `ask` prompts for every tool. `auto-all` approves tool calls and
client filesystem writes. With no `--approve`, in-workspace `fs/write_text_file`
calls stay silent, which is the GUI default for agents that use the client
filesystem. Cursor does not. See below.

### What Cursor does, separate from Backchat

This is Cursor's own ACP behavior, measured by cursor killer against
`cursor-agent` 2026.10.01 over raw stdio, with no Backchat process in the
path. Global cli-config was `approvalMode: allowlist` and `allow: ["Shell(ls)"]`.
A follow-up run with the machine's `preToolUse` hook disabled was the same.
See the table on PR #28.

| Mode | `request_permission` for an edit | `fs/write_text_file` | File written |
| --- | --- | --- | --- |
| agent (default), any `clientCapabilities.fs` | no | no | yes, directly |
| plan | no | no | no; the agent calls `cursor/create_plan` |
| ask | no | no | no; the model refuses |
| agent, shell `echo` | yes, `kind: execute` | — | no, after reject |
| agent plus project `.cursor/cli.json` deny `Write(**)` | no | no | no; the tool says permission denied |

Cursor does not advertise a client-settable approval option. `session/new`
offers modes `agent`, `plan`, and `ask`, and config options `mode` and
`model`. Shell commands follow the cli-config allowlist and do send
`session/request_permission`. A rejected or denied tool call still ends with
status `completed`, so that status is not success. An edit `tool_call` starts
with empty `rawInput`, then a path; the diff arrives on completion, after the
write. `clientCapabilities.fs` does not change this: the edit tool never
calls `fs/write_text_file`.

### What Backchat does about that

Cursor edits cannot be approved one by one. Backchat is not dropping a
permission request; agent mode never sends one. Backchat does not invent a
prompt Cursor will not send, and it does not write `.cursor/cli.json` into
the checkout.

When a Cursor session requires approval, Backchat calls `session/set_mode`
(and the `mode` config option, when Cursor lists the value there) before the
first prompt:

- `--approve ask` or `--approve auto-read`
- no `--approve`, unless Settings → permission mode is Auto
- a read-only session (`permission_mode: read_only`), even if that session
  also passed `--approve auto-all`

The mode is `ask` when Cursor advertises it, otherwise `plan`. Both modes
leave the file untouched. `plan` may call `cursor/create_plan`; Backchat
answers that through the normal permission broker, or with a rejected outcome
when no broker is installed, and does not surface a protocol error. If
neither mode can be selected, the session does not start.

Cursor may write files directly only when the caller opts into that:

- `session start --approve auto-all`
- or Settings permission mode Auto, when the session has no stricter
  `--approve` policy

That opt-in leaves the default `agent` mode in place. Shell commands can
still ask, based on Cursor's own allowlist. If a non-read tool starts without
an approval after Backchat has left agent mode, the turn is cancelled. That
cancel does not undo a write that already landed, which is why the mode
switch happens first.

`tool_call` status `completed` is not success. The stream's `outcome` and the
transcript's tool `status` use the permission decision or the tool result
when one is present: `ok` / `completed` only then, otherwise `denied`,
`failed`, `cancelled`, or `finished`.

`session send --wait` blocks until the turn finishes and includes `reply`,
the assistant text of that turn. `--timeout <sec>` returns the current
session state and exits `4` instead of failing the turn. `--stream` prints
one NDJSON line as soon as it arrives and flushes it, including a
`permission` line while the turn is still waiting. A coordinator can read
that line and call `session respond` before the turn ends.

`session status` includes `last_outcome` (`idle`, `running`, `complete`,
`error`, or `cancelled`) and `last_reply` when the last turn produced text.

`session transcript` merges adjacent assistant text chunks. Tool rows include
`name` and `status: start` when the tool starts, a later `tool_result`, a
`status` row when the turn completes or is cancelled, and `permission` rows
with `status` `pending`, `selected`, `rejected`, or `cancelled`. A tool result
status of `completed` means the permission outcome or the tool result showed
success. Wire status `completed` with neither of those is `finished`. A
rejected call is `denied`.

`session transcript --since <cursor>` returns only newer events. `cursor` is
the monotonic event sequence.

The coordinator does its own git commit and push. This CLI does not.

## Exit codes

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | ok | The command finished |
| 1 | error | Unexpected failure |
| 2 | app_not_running | The socket is missing or Backchat is not running |
| 3 | not_found | The project, workspace, session, or request does not exist |
| 4 | timeout | `--wait` or `--stream` reached `--timeout` and returned the current state |
| 5 | invalid_args | Missing flags, bad paths, an unknown agent, a missing source directory, a workspace that already exists, or a dirty workspace without `--force` |

With `--json`, argument errors are a JSON object on stderr (`ok: false`,
`error.code: invalid_args`) and the process still exits `5`. Control-call
failures stay on stdout.

## NDJSON stream

`session send --stream` writes one JSON object per line:

| `type` | When |
| --- | --- |
| `message_delta` | Assistant text chunk. `text` is the delta |
| `tool_call` | `status` is `start` or `end`. `outcome` on `end` is `ok`, `denied`, `failed`, `cancelled`, or `finished`. `end` alone is not success. Includes `tool_call_id`, `title`, `kind` |
| `permission` | A permission request is waiting. Includes `request_id` and `options` |
| `result` | Turn finished. `status` is `complete`, `error`, `cancelled`, or `timeout` |

Every line has `session_id` and `timestamp`. A `timeout` result is exit code 4.

## Transcript events

`session transcript --json` returns `{ "session_id", "events" }`. Each event:

| Field | Meaning |
| --- | --- |
| `cursor` | Stable decimal sequence. Pass it to `--since` |
| `role` | `user`, `assistant`, `tool`, or `system` |
| `type` | `text`, `tool_call`, `tool_result`, `permission`, `thought`, or `status` |
| `timestamp` | ISO-8601 |
| `text` | Message, thought, or tool output when present |
| `tool_call_id`, `name`, `status`, `request_id` | Present for tool and permission events |

## Example

```bash
export BACKCHAT_CLIENT="cursor killer"

backchat project create --json \
  --name hilo \
  --source "$HOME/Proj/hilo-agent-opencode/minimaxhub_benchmark" \
  --source "$HOME/Proj/hilo-agent-opencode/hilo-agent-opencode"

backchat workspace create --json \
  --project project-… \
  --branch feature/coord \
  --base main

backchat workspace show ws-… --json

backchat session start --json \
  --workspace ws-… \
  --agent cursor \
  --approve auto-read \
  --prompt "Look through both source trees and summarize the layout."

backchat session send sess-… "What is the next step?" --stream --timeout 120

backchat session transcript sess-… --json
backchat session transcript sess-… --since 40 --json

backchat work submit --json --project project-… --text "Review the branch"
backchat work list --project project-… --json
backchat work steer --project project-… --task task-… --text "Skip generated files" --json
backchat work status project-… --json
```

`work submit` in that example does not require a project coordinator in the
GUI. A second project can keep its built-in coordinator configured; external
tasks stay attributed to `cursor killer` and built-in threads stay on the
Project coordinator.

The fake ACP agent used by local evidence runs echoes the prompt it receives.
A transcript that contains the raw prompt JSON is that echo, not the GUI
dumping protocol messages into the chat.

## Threat model

The control server is a local capability, not a network service.

- It binds a Unix domain socket or a Windows named pipe. It never listens on a
  TCP port.
- The socket file is mode `0600` under the storage root. The kernel refuses
  connections from other users. If the mode is changed, the server rejects the
  request.
- When the runtime can read peer credentials, a uid other than the Backchat
  process user is rejected.
- Requests are not separately authenticated. Any process of the same user can
  call the API, the same way it can drive the app through the GUI. Root can
  bypass file permissions; that is outside this boundary.
