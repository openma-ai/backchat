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

`--client <name>` or `BACKCHAT_CLIENT` names the coordinator (for example
`cursor killer`). The CLI stores that name on every session it starts and on
project work it submits. The GUI shows `External · cursor killer` on the
session row and in the session header, and `External coordinator: cursor killer`
on the project work list. Those sessions otherwise behave like any other chat:
open them, continue them, cancel them, and answer permissions in the GUI or
with `session pending` / `session respond`.

## Commands

```bash
backchat project list
backchat project show <id>
backchat project create --name <name> --source <dir> [--source <dir> ...]

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

A managed workspace is one git worktree per source repository, all on the same
branch name. If that branch already exists, the worktree checks it out.
`--base` is the start point for a new branch. When the branch already exists,
`--base` must be an ancestor of that branch or the command fails. A `--base`
ref that does not resolve names that ref in the error.

`workspace show` returns each repository's worktree path, branch, HEAD sha, and
dirty state. `workspace remove` deletes the managed worktrees and refuses when
they have uncommitted changes unless `--force` is set. It deletes a branch only
when this workspace created that branch; a branch that already existed and was
checked out is left in the repository. The live project checkout is never
deleted.

`session start --approve auto-read` auto-approves read-only tool calls for that
session only. Writes still appear in the GUI and in `session pending`.
`auto-all` approves tool calls and out-of-workspace file writes.
`ask` is the default.

`session send --wait` blocks until the turn finishes. `--timeout <sec>` returns
the current session state and exits `4` instead of failing the turn.
`--stream` prints NDJSON until the turn finishes or the timeout fires.

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
| 5 | invalid_args | Missing flags, bad paths, or a dirty workspace without `--force` |

## NDJSON stream

`session send --stream` writes one JSON object per line:

| `type` | When |
| --- | --- |
| `message_delta` | Assistant text chunk. `text` is the delta |
| `tool_call` | `status` is `start` or `end`. Includes `tool_call_id`, `title`, `kind` |
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
backchat work status project-… --json
```

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
