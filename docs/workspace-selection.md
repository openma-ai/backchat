# New-chat workspace selection

After choosing a local project folder, Backchat discovers Git repositories in
that folder or below it. Discovery skips hidden/dependency/build directories
and does not follow child symlinks. Sibling worktrees sharing a Git common
directory count as one repository, preferring its main checkout when present. A folder already inside a repository keeps
its relative working directory. Discovery stops with an error after 10,000
visited directories rather than returning a silently incomplete result.

The new-chat picker offers Local, saved workspaces, and New workspace.
Local uses the project's source folders without changing their branches.
Only saved combinations covering exactly the current project's repositories
appear as workspaces; partial combinations remain available as checkout choices.

New workspace defaults to creating fresh worktrees: a single workspace name
produces the same generated branch name in each repository. The independent
checkouts allow tasks to run in parallel. The existing worktree-store rollback
and ownership rules apply.

Use existing lets users select any checkout independently per repository,
including its source checkout/main. Choosing a branch suggests the unique
same-name checkout for repositories the user has not explicitly chosen yet.
An explicit choice is preserved; detached or ambiguous checkouts are not
automatically matched. This suggestion belongs to the creation UI, not the
global workspace list.

Saving an existing combination creates a persistent `linked` workspace. Session
start resolves its saved roots exactly. Removing a linked workspace deletes
only the saved reference; it never removes or merges the underlying checkouts.
Managed workspace deletion retains its existing worktree ownership behavior.
No cross-repository conflict analysis is performed.

A circular exclamation button on the right of the New workspace row explains
parallel workspaces.
The picker and explanation open automatically on the first eligible new-chat visit,
without taking keyboard focus. A local browser preference prevents repeated
automatic prompts; the button always allows reopening it manually. Its primary
action opens creation with fresh worktrees selected.

Creation immediately saves the workspace under its matching project, or saves a
project for the selected folder when needed. The sidebar expands that project
even before the first message. Older unowned workspaces can appear under an
unambiguous project matching their complete source-root set.

Session startup carries the resolved workspace project ID into the ready event,
persisted session, and restart parameters. Sidebar grouping uses that ownership
(or the workspace owner for older sessions) before falling back to directories;
starting sessions use their chosen source folder until the runtime cwd exists.

### Chat rendering follow-up

Session loading keeps the startup mark above a mounted, hidden chat surface until
history replay and the initial viewport layout have finished. Composer notices use
the composer material and radius with compact content padding. Local Markdown
references have a file treatment; directory targets open in the system file manager.

The shared UI dependency is patched in `patches/@openma__common-ui@0.4.0.patch` until
these changes are available upstream. Nested event groups start collapsed. Stream
output uses frame batches and a jerk-limited velocity controller. The first 16
UTF-16 units can appear immediately; a 64ms backlog horizon sets the target speed.
Acceleration is capped at 0.24 units/ms² and jerk at 0.002 units/ms³. The controller
integrates in steps of at most 4ms and retains fractional output credit. A new burst
changes the target without resetting velocity or acceleration. Measured render cost
coalesces expensive frames. The previous forced 48ms catch-up deadline is removed:
input stalls, final flushes, and a blocked main thread cannot promise smooth output.
