import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendEvent,
  closeSessionDb,
  deleteSession,
  hasPersistedSession,
  openSessionDb,
  upsertSession,
} from "./sql-store";

const tempRoots: string[] = [];

afterEach(async () => {
  closeSessionDb();
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function openTempDb(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "backchat-sql-store-persisted-"));
  tempRoots.push(root);
  openSessionDb(join(root, "sessions.db"));
  return root;
}

describe("hasPersistedSession", () => {
  it("is false for a session whose start failed before its row was written", async () => {
    await openTempDb();
    // A start error is the only event such a session ever emits; its row
    // does not exist, so appending would fail the foreign key.
    expect(hasPersistedSession("sess-never-started")).toBe(false);
    expect(() => appendEvent("sess-never-started", "openma_event", { type: "session.error" }))
      .toThrow(/FOREIGN KEY/);
  });

  it("follows the row through upsert and delete", async () => {
    const root = await openTempDb();
    upsertSession({ id: "sess-row", agent_id: "codex-acp", cwd: join(root, "cwd") });
    expect(hasPersistedSession("sess-row")).toBe(true);
    deleteSession("sess-row");
    expect(hasPersistedSession("sess-row")).toBe(false);
  });

  it("does not carry a cached row across databases", async () => {
    const root = await openTempDb();
    upsertSession({ id: "sess-other-db", agent_id: "codex-acp", cwd: join(root, "cwd") });
    expect(hasPersistedSession("sess-other-db")).toBe(true);
    closeSessionDb();
    await openTempDb();
    expect(hasPersistedSession("sess-other-db")).toBe(false);
  });
});
