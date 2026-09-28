# Project thread memory

Each Coordinator and Worker WorkThread owns a persistent directory of ordinary
files. The agent chooses filenames, subdirectories, formats and when to read or
maintain them. It can retain goals, progress, blockers, decisions, evidence or
other useful context. The application creates no starter file, requires no
per-turn read or write, and does not parse a schema or copy file contents into
the scheduling database.

Locally, the directory is
`~/.oma/backchat/projects/workspaces/thread-<identity>-memory/`.
The identity comes from the Project and WorkThread, so replacing an agent Session
or reopening the app retains the same notes. Another thread or project gets a
different directory. Notes live outside source checkouts and are included in the
agent's allowed additional workspace roots. Preparing or reopening a thread
preserves existing files.

Each turn supplies `memoryDirectory` in the session workspace context.
Coordinators can maintain the project-wide picture; Workers can retain their own
assignment and report evidence back. Agents use their native file tools to manage these files
when useful. Separate directories express ownership; they do not establish a
filesystem isolation boundary or guarantee that a crashed turn saved its state.

Cloud threads use OpenMA's existing memory-store resource, mounted at
`/mnt/memory/openmatter-thread-<identity>/`. The scheduler records the
remote store binding, not its file contents. Coordinator session replacements
reattach the same store; Workers retain their existing remote-workspace recovery
rules. Creating a store with an uncertain response requires reconciliation by
its saved identity before continuing, so retries do not create another store.
The scheduler does not initialize files in that directory or replace existing
agent-created contents.

OpenMA currently accepts memory-store resources at session creation only. Legacy
cloud sessions without that resource continue using their original session;
they are not silently replaced or falsely advertised as having a memory mount.

OpenMatter continues to persist execution facts in SQLite: queued commands,
session bindings, turns, events and cancellation. `project.status` lets the
Coordinator query those facts for its bound Project, optionally filtering by
Worker ID. It returns a bounded summary rather than arbitrary SQL or full tool
logs. A completed turn means execution ended, not that its work was accepted.
Current runtime facts take precedence over stale notes.

The local harness must support ACP additional workspace roots to access notes
outside its checkout. Pi, Codex and Claude compatibility follows the capability
advertised during ACP initialization; the client never sends unsupported fields.

Deterministic validation covers separate directories, empty initial directories,
preservation of agent-created files, stable paths on reopen, session create/resume
path propagation and scoped MCP queries. The opt-in real Pi test delegates a
red/green repair, explicitly asks both agents to save proof in files of their
choice, checks those files and their write events, and verifies the returned
Worker through `project.status`. That task-specific evidence requirement does
not impose a general read/write schedule on project agents.
