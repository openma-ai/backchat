# End-to-End Test Suite Design

Status: draft
Date: 2026-06-14
Owner: Backchat desktop

## Summary

Backchat already has Playwright/Electron smoke tests under `e2e/`, but those
tests mostly exercise renderer behavior through synthetic push events. The next
E2E suite should verify complete local-first flows:

- A fresh app process starts with an isolated `~/.openma` root.
- Main-process stores write SQLite and filesystem state.
- The renderer observes those writes through normal IPC.
- The app can restart and restore state.
- File-first exports produce inspectable transcript artifacts.

The suite should not depend on real model providers or real ACP agents for the
default CI path. Real-agent smoke tests are useful, but they belong in an
opt-in lane.

## Current Coverage

Existing `e2e/smoke.spec.ts` covers:

- Empty shell renders.
- Synthetic `session.ready` appears in sidebar and topbar.
- Slash command picker behavior.
- Composer model picker IPC calls.
- Attachment picker flow.

This is valuable UI smoke coverage, but it misses:

- Isolated user data and storage roots.
- SQLite persistence across process restarts.
- Session history replay from `sessions.db`.
- File-first export artifacts.
- Archive, pin, delete, search across real persisted rows.
- Failure diagnostics and recovery paths.

## Test Architecture

### 1. Isolated Storage Root

Add a test-only env override:

```text
BACKCHAT_HOME=/tmp/backchat-e2e-...
```

When set, main process should use:

```text
$BACKCHAT_HOME/config.toml
$BACKCHAT_HOME/registry-cache.json
$BACKCHAT_HOME/sessions.db
$BACKCHAT_HOME/sessions/
$BACKCHAT_HOME/transcripts/
```

This avoids tests reading or mutating the developer's real `~/.openma`.

Acceptance:

- Each `launchApp()` creates a unique temp root.
- `launchApp()` returns `{ app, page, home }`.
- Helper cleanup removes the temp root after each test unless
  `BACKCHAT_KEEP_E2E_HOME=1`.

### 2. Test Bridge Capabilities

Keep `BACKCHAT_TEST_HOOKS=1`, but extend the bridge narrowly:

```ts
window.__backchatTest.storageHome(): Promise<string>
window.__backchatTest.exportSessionFiles(opts?: { overwrite?: boolean }): Promise<ExportSessionFilesResult>
window.__backchatTest.readFile(path: string): Promise<string>
window.__backchatTest.exists(path: string): Promise<boolean>
window.__backchatTest.closeAndRelaunch(): Promise<void> // helper-level, not preload
```

Rules:

- File read helpers must be scoped to `BACKCHAT_HOME`.
- Export hook should call the same `exportSessionFiles()` library used by
  future CLI/UI entrypoints.
- Do not expose arbitrary shell execution.

### 3. Fake ACP Agent Lane

For tests that need actual `session:start` and `prompt` calls, use the local
fake ACP agent executable:

```text
e2e/fixtures/fake-acp-agent.mjs
```

It should stay small and deterministic:

- Speak the minimum ACP protocol needed by `AcpRuntimeImpl`.
- Emit deterministic `session.ready`, text chunks, tool updates, and complete.
- Never call a network or model provider.

Default CI should run against the fake agent. A real-agent smoke can run only
when `BACKCHAT_E2E_REAL_AGENT=1`.

## Suite Layout

```text
e2e/
  helpers.ts
  smoke.spec.ts
  storage.spec.ts
  file-first-export.spec.ts
  archive-search.spec.ts
  fixtures/
    fake-acp-agent.mjs
```

## P0 Tests

These should be implemented first because they prove the storage foundation.

## User-Visible Persistence Invariants

These are the product promises the E2E suite should enforce:

- A session that reached `session.ready` appears in the sidebar after app
  restart.
- A completed turn replays with the user's prompt and the assistant/tool
  timeline after app restart.
- A prompt submitted before a turn error is still visible after restart.
- A session with no submitted prompt may disappear, because drafts are not
  durable product state today.
- No completed turn may be lost during ordinary quit/relaunch.
- Mid-turn process crash should preserve the submitted user prompt and any
  streamed ACP events that already reached the main process.

The last point is an explicit current limitation, not a desired long-term
guarantee. Events still inside the upstream ACP child, model connection, or
transport buffer cannot be recovered if they were never delivered to the main
process.

### `storage.spec.ts`

#### starts with an isolated Backchat home

Flow:

1. Launch app with temp `BACKCHAT_HOME`.
2. Ask bridge for `storageHome()`.
3. Assert it equals the helper's temp root.
4. Assert `config.toml` and `sessions.db` are created under that root.
5. Assert real `~/.openma` is not touched by this test path.

Why:

This is the prerequisite for every reliable desktop E2E.

#### persists injected session across restart

Flow:

1. Launch app.
2. Inject `session.ready` for `e2e-persist`.
3. Inject a `user_prompt` and final `agent_message` through the real persistence
   path or a dedicated test hook that calls the same main-process store.
4. Close app.
5. Relaunch with the same `BACKCHAT_HOME`.
6. Assert sidebar contains the restored session title.
7. Open session and assert transcript text is visible.

Why:

This verifies renderer -> main IPC -> SQLite -> restart -> renderer replay.

#### completed conversation survives ordinary quit and relaunch

Implemented in `storage.spec.ts` as `replays a UI-created conversation after
relaunch`.

Flow:

1. Launch app with temp `BACKCHAT_HOME`.
2. Start a session using the fake ACP agent from the UI.
3. Submit `Remember this: e2e-persistence-token`.
4. Wait for `session.complete`.
5. Close app normally.
6. Relaunch with the same `BACKCHAT_HOME`.
7. Assert the sidebar contains the session title derived from the prompt.
8. Click the session.
9. Assert both the user prompt and fake assistant response are visible.
10. Assert the live turn also wrote transcript JSONL and session metadata TOML
    files under `transcripts/YYYY/MM/DD/`.
11. Assert any fake tool events replay in the same order they appeared live.

Why:

This is the primary user-facing guarantee: completed work is still there after
restart.

#### submitted prompt survives turn error

Implemented in `storage.spec.ts` as `replays the submitted prompt after a turn
error`.

Flow:

1. Launch app with temp `BACKCHAT_HOME`.
2. Start a fake ACP session configured to fail after accepting a prompt.
3. Submit `This prompt should survive`.
4. Wait for the UI error.
5. Close and relaunch.
6. Open the session.
7. Assert the user prompt is visible.
8. Assert no successful assistant response is invented.

Why:

The current main process writes `user_prompt` before calling `acp.prompt()`.
This test prevents regressions where failed turns erase the user's input.

#### empty draft is not restored as a durable session

Implemented in `storage.spec.ts` as `does not restore an empty draft as a
durable session`.

Flow:

1. Launch app.
2. Press New Chat or visit the empty composer.
3. Do not submit a prompt.
4. Close and relaunch.
5. Assert no blank "New chat" row was created solely by opening the composer.

Why:

This documents the current UX: drafts are ephemeral until the user actually
submits.

#### search finds persisted prose after restart

Implemented in `storage.spec.ts` as `finds persisted prose in command palette
search after relaunch`.

Flow:

1. Create persisted session with unique text.
2. Restart.
3. Open command palette search.
4. Search the unique text.
5. Assert the result points to the correct session.

Why:

This verifies FTS is not only a unit-level concern.

#### archived prose remains searchable while SQLite exists

Implemented in `storage.spec.ts` as `finds archived prose in command palette
search after relaunch`.

Flow:

1. Create a persisted session with unique prose.
2. Archive it through the public renderer IPC surface.
3. Close and relaunch with the same `BACKCHAT_HOME`.
4. Assert the session is hidden from the normal sidebar.
5. Search the unique prose in the command palette.
6. Assert the archived session appears in search results.
7. Assert transcript metadata sidecars do not contain `archived_at` or
   `pinned_at`.
8. Delete `sessions.db`, `sessions.db-wal`, and `sessions.db-shm`.
9. Relaunch with the same transcript files.
10. Assert the session is rebuilt as active and visible.

Why:

Archive and pin are SQLite-owned UI organization state. Ordinary restarts keep
that state because the SQLite index remains, but file-first rebuild from
transcripts intentionally restores the semantic conversation history as active
and unpinned.

#### transcript files rebuild the SQLite index

Implemented in `storage.spec.ts` as `rebuilds visible history from transcript
files when the SQLite index is missing`.

Flow:

1. Launch app with temp `BACKCHAT_HOME`.
2. Start a session using the fake ACP agent from the UI.
3. Submit `file-primary-rebuild-token`.
4. Start a second session and submit `second-file-primary-rebuild-token`.
5. Wait for both prompts and fake assistant responses to render.
6. Close app normally.
7. Assert two transcript JSONL files and two session metadata TOML files exist.
8. Assert each transcript file uses local `seq` values `[1, 2]`.
9. Delete `sessions.db`, `sessions.db-wal`, and `sessions.db-shm`.
10. Relaunch with the same `BACKCHAT_HOME`.
11. Assert the sidebar contains both restored session titles.
12. Open both sessions and assert user and assistant text replay.
13. Search for `rebuild-token` in the command palette and assert both restored
    sessions appear.

Why:

This is the user-visible proof that multiple transcript files can act as source
truth while SQLite is rebuilt as a hot index.

#### hard delete removes source files before rebuild

Implemented in `storage.spec.ts` as `does not resurrect a hard-deleted session
after rebuilding the SQLite index`.

Flow:

1. Launch app with temp `BACKCHAT_HOME`.
2. Start a session using the fake ACP agent from the UI.
3. Submit `hard-delete-rebuild-token`.
4. Archive and hard-delete it through the public renderer IPC surface.
5. Assert transcript JSONL and session metadata TOML are gone.
6. Delete `sessions.db`, `sessions.db-wal`, and `sessions.db-shm`.
7. Relaunch with the same `BACKCHAT_HOME`.
8. Assert the deleted title is not in the sidebar.
9. Search for `hard-delete-rebuild-token` and assert no session match appears.

Why:

This prevents a file-first rebuild from resurrecting sessions the user
permanently deleted.

### `file-first-export.spec.ts`

#### exports SQLite sessions to transcript files

Flow:

1. Launch app with temp home.
2. Create one persisted session with user and assistant text.
3. Call `__backchatTest.exportSessionFiles()`.
4. Assert result reports one exported session.
5. Assert:
   - `transcripts/YYYY/MM/DD/<session_id>.jsonl` exists.
   - `transcripts/YYYY/MM/DD/<session_id>.meta.toml` exists.
   - JSONL lines parse and include `schema_version`, `seq`, `type`, `ts`,
     `data`, and `source`.
   - TOML includes `schema_version`, `session_id`, `agent_id`, `title`,
     `workdir`, and timestamps.
   - TOML does not include SQLite-only UI state such as `archived_at` or
     `pinned_at`.

Why:

This is the first true file-first E2E.

#### skips existing transcript unless overwrite is set

Implemented in `file-first-export.spec.ts` as `skips existing transcript files
unless overwrite is set`.

Flow:

1. Export once.
2. Edit the JSONL file through scoped test helper or Node side.
3. Export again without overwrite.
4. Assert result marks the session as skipped and the edit remains.
5. Export with overwrite.
6. Assert result marks it as written and file matches store state.
7. If only one of JSONL or metadata sidecar exists, assert export fills the
   missing counterpart without overwriting the existing file.

Why:

Prevents accidental loss of user-edited source files.

#### exports pair wrapper metadata

Flow:

1. Create a pair session with two member sessions.
2. Export.
3. Assert `<pair_id>.pair.meta.toml` exists.
4. Assert member sidecars include `pair_id`.
5. Assert pair and member sidecars do not include SQLite-only UI state such as
   `archived_at` or `pinned_at`.

Why:

DB rebuild cannot restore pair chats without pair metadata. Unit coverage also
checks that pair sidecars are projected back into `pair_sessions` and member
session sidecars keep their `pair_id` links.

## P1 Tests

These cover the main user-visible storage behaviors.

### `archive-search.spec.ts`

#### archive hides from sidebar but remains restorable

Flow:

1. Create persisted session.
2. Archive through UI.
3. Assert sidebar hides it.
4. Open Settings -> Archive.
5. Assert archived row appears.
6. Restore.
7. Assert sidebar shows it again.

#### delete removes DB row, workdir, and source transcript

Flow:

1. Create persisted session and write a file in its session workdir.
2. Delete through UI.
3. Assert session disappears from sidebar and archive page.
4. Assert workdir no longer exists under `BACKCHAT_HOME/sessions/<id>`.
5. Assert transcript JSONL and session metadata TOML no longer exist.

#### pin order survives restart

Flow:

1. Create two sessions.
2. Pin the older one.
3. Restart.
4. Assert pinned section orders by `pinned_at` and normal chats by
   `last_used_at`.

This covers ordinary app restarts with SQLite intact. A file-first rebuild after
deleting SQLite should restore sessions as unpinned.

## P2 Tests

These are broader confidence tests and can run less frequently.

### Fake ACP Full Turn

Flow:

1. Register fake ACP agent through test config.
2. Start a real session from UI.
3. Submit prompt.
4. Fake agent streams thinking, text, tool call, and completion.
5. Assert UI renders streaming states.
6. Restart and assert final history replays.

### File Artifact Discovery

Flow:

1. Fake agent writes `index.html` or `result.png` into session workdir.
2. App discovers it in the side rail.
3. Clicking the artifact opens the expected browser/file tab.

### Full Export Then Rebuild Parity

The startup rebuild prototype now covers single-session sidebar, history, and
search restoration from live transcript files. This broader parity test remains
for pair sessions and richer metadata.

Flow:

1. Create sessions, pair sessions, search data, and ordinary-restart
   archive/pin fixtures.
2. Export file-first artifacts.
3. Delete `sessions.db`.
4. Run rebuild.
5. Launch app.
6. Assert sidebar, history, search, and pairs match pre-delete state.
7. Assert archive and pin state reset because they are SQLite-only UI state.

## CI Lanes

### Fast PR Lane

Command:

```bash
pnpm build
pnpm exec playwright test e2e/smoke.spec.ts e2e/storage.spec.ts e2e/file-first-export.spec.ts
```

Constraints:

- No network.
- No real ACP agent.
- Temp `BACKCHAT_HOME`.
- Serial workers.
- Electron window hidden by default.

For local visual debugging, opt into the normal visible Electron window:

```bash
BACKCHAT_E2E_VISIBLE=1 pnpm exec playwright test e2e/smoke.spec.ts
```

### Nightly Lane

Command:

```bash
BACKCHAT_E2E_REAL_AGENT=1 pnpm test:e2e
```

Adds:

- Fake ACP full turn.
- Optional real installed ACP smoke.
- Export/rebuild once rebuild exists.

## Implementation Order

1. Add `BACKCHAT_HOME` override in main process.
2. Update `e2e/helpers.ts` to create and clean temp homes.
3. Add scoped test bridge helpers for storage home, export, exists, readFile.
4. Implement `storage.spec.ts`.
5. Implement `file-first-export.spec.ts`.
6. Add fake ACP agent fixture.
7. Split existing smoke coverage into smaller specs if it grows further.

## Guardrails

- E2E tests must never touch real `~/.openma`.
- Default E2E tests must not require Claude, Codex, network access, or API keys.
- Test bridge APIs must stay behind `BACKCHAT_TEST_HOOKS=1`.
- File helpers must reject paths outside `BACKCHAT_HOME`.
- Avoid visual-only assertions when a semantic role or bridge assertion exists.
- Screenshots are only for debugging or deliberate regression artifacts.
