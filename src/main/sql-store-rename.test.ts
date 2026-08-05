import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getSession,
  openSessionDb,
  renameSession,
  setSessionTitle,
  upsertSession,
} from "./sql-store";

let tempRoot = "";

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

describe("sql-store session rename", () => {
  it("keeps a user rename when an agent later proposes a title", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "backchat-sql-store-rename-"));
    openSessionDb(join(tempRoot, "sessions.db"));
    upsertSession({
      id: "sess_rename",
      agent_id: "codex-acp",
      cwd: join(tempRoot, "workspace"),
      title: "",
    });

    renameSession("sess_rename", "My task");
    setSessionTitle("sess_rename", "Agent suggestion");

    expect(getSession("sess_rename")).toMatchObject({
      id: "sess_rename",
      title: "My task",
    });
  });
});
