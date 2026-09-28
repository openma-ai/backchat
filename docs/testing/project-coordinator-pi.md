# Real Pi coordinator regression

This opt-in test makes real model requests using the installed Pi adapter and
its configured provider. Ordinary test runs skip it.

```sh
pnpm test:e2e:real:pi-coordinator
```

Set `OPENMA_REAL_PI_COMMAND` to an executable adapter when testing an unpublished
local build. `PI_CODING_AGENT_DIR`, `PI_ACP_MODEL`, and `PI_ACP_SESSION_DIR` can
point Pi at an isolated configuration. Supply provider credentials through the
process environment; do not put them in Backchat settings or test artifacts.
Set `OPENMA_REAL_PI_EXPECT_VERSION=0.1.3` when verifying that release: both
Coordinator and Worker must report that version through ACP initialization
and advertise HTTP MCP support. With no command override, the test uses
Backchat's managed `openma-acp-pi-acp` executable.

The test creates an isolated Backchat database and a temporary Git repository
with two failing addition tests. It submits a message through the Coordinator
composer, then checks the actual event stream and repository state:

- Coordinator invokes the ACP-injected Project MCP delegation tool exactly once.
- Pi Worker gets a separate worktree and runs failing tests, repairs the
  implementation, and reruns the tests successfully.
- Tests and original source checkout remain unchanged.
- The Worker writes a random proof token. Its result and turn provenance reach
  the original Coordinator session, which reviews and repeats that token.
- Each WorkThread exposes an absolute `memoryDirectory` through its session's
  `externalHandle.raw`. Coordinator and Worker have different persistent
  directories outside both source workspaces.
- Each agent saves the Worker's random proof token in at least one ordinary
  UTF-8 text file inside its own memory directory. The agent chooses the filename,
  subdirectories, format and maintenance timing. Recursive inspection skips
  symbolic links and binary files; successful native file-tool events identify
  the actual evidence files written by each session.
- Coordinator writes stay inside its own memory directory; the Worker does not
  edit those notes. The Worker checkout contains only the requested `sum.mjs`
  repair and `worker-proof.txt`, with no memory files added to source.
- Coordinator calls `project.status` after delegation and again during review.
  The first snapshot reports its running turn and either queued work or the
  newly created Worker. The review snapshot identifies the actual Worker session,
  completed turn, and returned proof token. An accepted delegation receipt is
  not treated as completed work.
- All three turns finish successfully: initial coordination, Worker, review.

The application provides a persistent directory without creating a starter file
or prescribing how often to read or write. This fixture explicitly asks both
agents to save the random token as task evidence and use native file tools so
writes can be verified from events. It does not require a particular memory
filename, a read before writing, a checkpoint on every turn, or a fixed success
phrase from the model.

Test output includes RED/GREEN output, scoped project facts, JSON snapshots of
both memory directories' text files, an evidence JSON with status snapshots, and
a UI screenshot. Temporary app data is cleaned up. The adapter uses standard
ACP `mcpServers`; no private Pi extension or custom launch injection is needed.

This three-turn test proves that both sessions save their requested evidence in
separate thread directories and that the Coordinator verifies the returned
Worker against runtime facts. It does not require a later memory read or prove
recovery after replacing the ACP session; deterministic workspace tests cover
path stability and preservation of agent-created files across session
generations. A separate real reconnect test would require another paid model
turn. Saved artifacts document the implementation and test version used for
that run; they do not validate subsequent changes.
