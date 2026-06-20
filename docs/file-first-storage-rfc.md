# File-First Storage RFC

Status: draft
Date: 2026-06-14
Owner: Backchat / openma local runtime

## Summary

Backchat should treat durable, user-facing agent state as files first, and
SQLite as a derived hot layer. SQLite remains useful for ordering, indexes,
search, pending queues, and UI lists. It should not be the only place where
the agent's long-lived knowledge, rules, skills, sessions, or trajectories
exist.

The design rule:

```text
Files are the source of truth. SQLite is the materialized view.
```

This keeps the desktop app local-first while making the harness easier to
inspect, back up, migrate, diff, repair, and evolve by agents themselves.

## Motivation

Backchat currently has a mixed model under `~/.openma`:

- `config.toml` is hand-editable file state.
- `sessions/<session_id>/` is a per-session working directory for agent output.
- `registry-cache.json` is a file cache.
- `sessions.db` stores session rows, pair-session rows, event history, and FTS.

That model works well for an app, but the agent harness needs a stronger
property: the important state should be directly visible as ordinary files.
Codex has this feel because sessions, rules, browser state, shell snapshots,
attachments, skills, and other artifacts are legible in the dotdir even when
some indexes and caches live in SQLite.

For self-evolving agent systems, file state has three advantages:

- Agent-readable: a harness can inspect and edit files using its normal tools.
- Portable: users can copy, sync, commit, or restore state without DB tooling.
- Auditable: JSONL, TOML, Markdown, and YAML can be reviewed and diffed.

The goal is not to remove SQLite. The goal is to make SQLite rebuildable.

## Current State

Desktop startup currently wires the shared dotdir like this:

```text
~/.openma/
  config.toml
  registry-cache.json
  sessions.db
  sessions/
    <session_id>/
      agent-created files
```

`sessions.db` owns:

- `sessions`: sidebar metadata, cwd, ACP session id, title, plus app-local
  archive and pin state.
- `pair_sessions`: wrapper rows for multi-agent chats.
- `events`: persisted chat/tool events in append order.
- `messages_fts`: full-text search projection over prose events.

The existing event-table shape is sound for hot UI reads and search. The
problem is that a transcript can only be fully understood by opening SQLite.

## Target Layout

The proposed long-term dotdir is:

```text
~/.openma/
  config.toml

  agents/
    codex.toml
    claude.toml

  rules/
    default.md

  skills/
    <skill_id>/
      SKILL.md
      ...

  memories/
    facts.jsonl
    reflections.md

  transcripts/
    2026/
      06/
        14/
          <session_id>.jsonl
          <session_id>.meta.toml

  sessions/
    <session_id>/
      agent-created files

  trajectories/
    <session_id>.oma.trajectory.v1.json

  indexes/
    sessions.db
```

The exact date partition can change, but the principle should not: transcript
files and metadata files are canonical; SQLite indexes them. `sessions/`
continues to hold per-session working directories during the first migration
phase.

## State Classes

### Source-of-truth files

These files should be readable and editable without application-specific DB
tools:

- Global settings: `config.toml`
- Agent overrides: `agents/*.toml`
- MCP definitions: either `config.toml` or `mcp/*.toml`
- Rules: `rules/*.md`
- Skills: `skills/*/SKILL.md`
- Memories: `memories/*.jsonl`, `memories/*.md`
- Session transcript: `transcripts/YYYY/MM/DD/<session_id>.jsonl`
- Session metadata: `transcripts/YYYY/MM/DD/<session_id>.meta.toml`
- Pair-session metadata:
  `transcripts/YYYY/MM/DD/<pair_id>.pair.meta.toml`
- Trajectory export: `trajectories/*.oma.trajectory.v1.json`
- Eval tasks and rubrics, when added: `evals/*.yaml`

### SQLite Indexes And UI State

SQLite is the right tool for:

- Sidebar lists and sort order.
- Pin/archive flags as app-local UI organization state.
- Full-text search.
- Session id and title indexes.
- Pair-session membership indexes.
- Pending input queues.
- Rebuild checkpoints, such as last indexed file offset.

Everything in this class should be rebuildable from source files or safe to
discard. Pin/archive state is intentionally in the safe-to-discard bucket:
ordinary app restarts preserve it, but deleting SQLite and rebuilding from
transcripts restores sessions as active and unpinned.

### Runtime cache

Some state is not worth preserving as source truth:

- In-flight stream chunks not yet delivered to Backchat's main process.
- UI caches.
- Registry cache data.
- Temporary job status.

This state may live in SQLite, JSON cache files, memory, or temp dirs.

## Session JSONL

Backchat should write one JSON object per line. Each line is a persisted event
envelope:

```json
{"schema_version":"backchat.session_event.v1","seq":1,"type":"user_prompt","ts":1781424000000,"data":{"text":"Plan file-first storage."}}
{"schema_version":"backchat.session_event.v1","seq":2,"type":"agent_message","ts":1781424005000,"data":{"text":"Here is a plan..."}}
```

Required fields:

- `schema_version`: currently `backchat.session_event.v1`.
- `seq`: monotonic integer within the session file.
- `type`: existing Backchat event type, such as `user_prompt` or
  `agent_message`.
- `ts`: Unix epoch milliseconds.
- `data`: event-specific JSON payload.

Optional fields:

- `id`: stable event id, if present from ACP or generated locally.
- `parent_event_id`: causal link for tool results, replies, and future
  multi-agent events.
- `acp_session_id`: when the event needs to preserve upstream ACP identity.
- `source`: `desktop`, `cli`, `import`, or `repair`.

Backchat can continue to project ACP-specific events into its current
`user_prompt`, `agent_message`, `agent_thought`, `tool_call`, and
`tool_call_update` vocabulary. Server-side OMA trajectories can keep their
existing `user.message`, `agent.message`, and `agent.tool_use` names.

## Session Metadata

Each transcript should have a small TOML sidecar:

```toml
schema_version = "backchat.session_meta.v1"
session_id = "sess_..."
agent_id = "codex"
acp_session_id = "..."
title = "Plan file-first storage"
created_at = 1781424000000
last_used_at = 1781427600000
workdir = "~/.openma/sessions/workdirs/sess_..."
pair_id = ""
```

Pin/archive state is intentionally not source truth in the TOML sidecar. It is
app-local UI organization state owned by SQLite; ordinary restarts preserve it,
but deleting `sessions.db` and rebuilding from transcripts restores the semantic
history as active, unpinned sessions.

## Rebuild Contract

The storage layer should eventually support:

```text
delete ~/.openma/indexes/sessions.db
launch Backchat
scan source files
rebuild sessions, pair_sessions, messages_fts, and sidebar metadata
```

Rebuild should:

1. Discover `transcripts/**/*.meta.toml`.
2. Resolve each matching transcript JSONL.
3. Validate monotonically increasing `seq`.
4. Reconstruct `sessions` and `pair_sessions`.
5. Re-index prose events into FTS.
6. Record diagnostics for corrupt files without deleting them.

This contract is the main acceptance test for file-first storage.

## Migration Plan

### Phase 0: Document and inventory

- Land this RFC.
- Add a small storage inventory command or script later.
- Confirm every table in `sessions.db` is classified as source, derived, or
  runtime cache.

### Phase 1: Export only

Add a read-only exporter from current SQLite to files:

```text
sessions.db
  -> transcripts/YYYY/MM/DD/<session_id>.jsonl
  -> transcripts/YYYY/MM/DD/<session_id>.meta.toml
  -> transcripts/YYYY/MM/DD/<pair_id>.pair.meta.toml
```

No runtime write path changes in this phase. The exporter should be
idempotent and should refuse to overwrite a newer file unless explicitly
asked.

### Phase 2: Rebuild prototype

Add a rebuild path that creates a fresh index database from exported files.
This can first be a script before becoming part of app startup.

Acceptance:

- Session count matches before and after rebuild.
- Event count matches for every exported session.
- First user prompt and final assistant message match.
- Search finds the same representative queries.

Current implementation status:

- `openSessionDb()` now scans `transcripts/**/*.meta.toml` at startup after
  schema creation.
- For each session sidecar, it projects the matching JSONL transcript back into
  `sessions` and `events`; existing FTS triggers rebuild `messages_fts`.
- The user-visible E2E deletes `sessions.db`, `sessions.db-wal`, and
  `sessions.db-shm`, relaunches, then verifies sidebar, history replay, and
  command-palette search for two UI-created single-agent sessions.
- Rebuild imports pair wrapper sidecars back into `pair_sessions` and preserves
  member `pair_id` links from session sidecars.
- Richer diagnostics, full pair UI parity tests, and cross-machine import UX
  remain future work.

### Phase 3: Dual write

Append new events to both SQLite and JSONL. Write metadata sidecars whenever
session metadata changes.

Current implementation status:

- Live single-session events that pass through `appendEvent()` now write both
  SQLite and `transcripts/YYYY/MM/DD/<session_id>.jsonl`.
- JSONL `seq` values are numbered within each transcript file; SQLite's
  global `events.seq` primary key is not leaked into the file format.
- Live single-session metadata changes now write
  `transcripts/YYYY/MM/DD/<session_id>.meta.toml` for title, workdir, agent,
  ACP session id, and pair id fields. Pin/archive remain SQLite-only UI state.
- `appendEventsTx()` remains a legacy/import path for fixture and migration
  flows; those histories are still exported through Phase 1's exporter.
- Startup rebuild now uses the single-session JSONL/TOML files as source truth
  when the SQLite index is missing.
- Pair wrapper metadata changes now write
  `transcripts/YYYY/MM/DD/<pair_id>.pair.meta.toml`.
- Pair wrapper sidecars are projected back into `pair_sessions` during startup
  rebuild.

During dual write, add cheap consistency checks:

- Last JSONL `seq` equals the transcript event count for that session.
- JSONL event count equals SQLite event count for the session.
- Metadata sidecar title and pair fields match SQLite. Pin/archive are checked
  against SQLite only.

### Phase 4: File-primary writes

Flip the write order:

1. Append to the JSONL transcript.
2. Update the TOML sidecar if needed.
3. Update SQLite indexes from the file append.

If SQLite update fails, the app can retry indexing because the source event is
already durable.

### Phase 5: Self-evolving assets

Move harness-evolution assets into files with explicit load paths:

- `agents/*.toml` for command, args, env, label, defaults.
- `rules/*.md` for user and workspace policy.
- `skills/*/SKILL.md` for local skills.
- `memories/*.jsonl` and `memories/*.md` for agent memory.

The harness should read these files directly at startup or session creation.
SQLite may index or cache them, but should not own them.

## Server-Side OMA Boundary

OMA server runtimes can continue to use SQL event logs as their production hot
path. Cloudflare Durable Object SQLite, D1, Postgres, and local SQLite are
good fits for concurrency, ordering, crash recovery, and streaming state.

The server requirement is different:

- The event log may stay SQL-primary for live execution.
- The trajectory API/export should produce durable file artifacts.
- Imports should be able to replay a trajectory or session JSONL into SQL.

In short: desktop should become file-primary because it is a local agent home;
server should remain log-primary but export file artifacts for training,
debugging, migration, and self-host portability.

## Compatibility

The migration should preserve:

- Existing `~/.openma/config.toml`.
- Existing `~/.openma/sessions.db` until rebuild is proven.
- Existing per-session working directories.
- Existing ACP resume behavior.
- Existing search and sidebar behavior.

The likely path is to move working directories from `sessions/<session_id>/` to
`sessions/workdirs/<session_id>/` only after transcript files are introduced,
or keep workdirs in the current location and put transcripts under
`transcripts/YYYY/MM/DD/`. Avoid mixing agent-created files and Backchat-owned
transcript files in the same directory without a clear namespace.

## Risks

- Dual write can drift if both stores are treated as writable authorities.
- JSONL append needs atomic write discipline to avoid partial-line corruption.
- Rebuilding large histories may need progress UI.
- User-edited files can be invalid; diagnostics must be clear and non-
  destructive.
- Secrets must not leak into easy-to-sync files without an explicit policy.

## Open Questions

- Should working directories eventually move from `sessions/<session_id>/` to
  `sessions/workdirs/<session_id>/`, or stay where they are?
- Should session JSONL use Backchat's current event names or the OMA
  `SessionEvent` vocabulary everywhere?
- Should memory be a generic JSONL log, a set of Markdown notes, or both?
- Should `registry-cache.json` move under `cache/` to make its derived nature
  obvious?

## Acceptance Criteria

- A user can inspect a session transcript without opening SQLite.
- Deleting `sessions.db` and restarting can rebuild single-session sidebar,
  history, and search from transcript files. SQLite-only UI state such as
  archive and pin is not restored by rebuild.
- Hard-deleting a session removes its transcript source files so rebuild does
  not resurrect it.
- A session export can be copied to another machine and imported.
- A harness can read rules, skills, memories, and agent config through normal
  filesystem tools.
- SQLite tables are documented as either derived indexes or runtime cache.
- No existing Backchat session is lost during migration.
