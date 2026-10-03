# Backchat local control CLI

An external coordinator running on the same machine can drive Backchat projects
and workspaces without clicking through the GUI. The Electron main process
listens on a Unix domain socket (a named pipe on Windows) and the `backchat`
command speaks HTTP-shaped JSON to it. The handlers call the same project,
workspace, session, and work services the GUI uses, so the sidebar stays live.

There is no TCP port.

## Install

Starting Backchat installs a `backchat` launcher into the first writable
directory among `~/.local/bin` and the desktop CLI paths in
`src/main/cli-path.ts` (`/opt/homebrew/bin`, `/usr/local/bin`, and
`/opt/local/bin` on macOS). The launcher runs `node` against the CLI shipped
with the app. Add `~/.local/bin` to `PATH` if it is not already there.

The socket is `<storage root>/control.sock`. The storage root is `~/.oma`, or
`$BACKCHAT_HOME` when `BACKCHAT_TEST_HOOKS=1`. Override the socket with
`BACKCHAT_CONTROL_SOCK`. If that path would be longer than 100 bytes (the
macOS Unix-socket limit), both the app and the CLI use
`/tmp/backchat-<hash>.sock` instead so startup cannot fail with
`ENAMETOOLONG`. A failure to bind the socket is logged and does not stop the
GUI.

## Caller identity

`--client <name>` or the `BACKCHAT_CLIENT` environment variable names the
external coordinator (for example `cursor killer`). Session and work commands
store that name on the records they create. The GUI shows it as
`External · <name>` on the session and `External coordinator: <name>` on
project work.

## Commands

```bash
backchat project list
backchat project show <id>
backchat project create --name <name> --source <dir> [--source <dir> ...]
backchat workspace list [--project <id>]
backchat workspace show <id>
backchat workspace create --project <id> --branch <name> [--base <ref>]
backchat workspace remove <id> [--force]
```

Every command accepts `--json` and prints a JSON document on stdout. Failures
use a non-zero exit code. With `--json`, the error document is also on stdout:

```json
{ "ok": false, "error": { "code": "not_found", "message": "Project not found: …" } }
```

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

## Exit codes

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | ok | The command finished |
| 1 | error | Unexpected failure |
| 2 | app_not_running | The socket is missing or Backchat is not running |
| 3 | not_found | The project, workspace, session, or work item does not exist |
| 4 | timeout | `--wait` or `--stream` reached `--timeout` and returned the current state |
| 5 | invalid_args | Missing flags, bad paths, or a dirty workspace without `--force` |

## Example

```bash
backchat --client "cursor killer" project create \
  --name hilo \
  --source "$HOME/Proj/hilo-agent-opencode/minimaxhub_benchmark" \
  --source "$HOME/Proj/hilo-agent-opencode/hilo-agent-opencode" \
  --json

backchat workspace create --project project-… --branch feature/coord --base main --json
backchat workspace show ws-… --json
```

Session, transcript, and work commands are covered by the same socket. See the
rest of this document once those commands are enabled in the app you are
running. The exit codes above already include timeout for `session send
--wait --timeout <sec>`.

## Threat model

The control server is a local capability, not a network service.

- It binds a Unix domain socket or a Windows named pipe. It never listens on a
  TCP port.
- The socket file is mode `0600`, created under the storage root. The kernel
  refuses connections from other users. If the mode is changed, the server
  rejects the request.
- When the runtime can read peer credentials, a uid other than the Backchat
  process user is rejected.
- Requests are not separately authenticated. Any process of the same user can
  call the API, the same way it can drive the app through the GUI. Root can
  bypass file permissions; that is outside this boundary.
- The CLI does not add commit or push commands. The coordinator uses git itself.
