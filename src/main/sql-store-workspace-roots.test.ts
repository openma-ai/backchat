import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { getSession, openSessionDb, upsertSession } from "./sql-store";

let root: string;

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("sql-store per-session workspace roots", () => {
  it("persists the effective secondary roots and preserves them on later partial upserts", async () => {
    root = await mkdtemp(join(tmpdir(), "backchat-workspace-roots-"));
    openSessionDb(join(root, "sessions.db"));

    upsertSession({
      id: "sess-worktree-roots",
      agent_id: "codex-acp",
      cwd: "/managed/worktrees/sess-worktree-roots/01-app",
      additional_directories: [
        "/managed/worktrees/sess-worktree-roots/02-docs",
      ],
      project_id: "proj-multi",
    });
    upsertSession({
      id: "sess-worktree-roots",
      agent_id: "codex-acp",
      cwd: "/managed/worktrees/sess-worktree-roots/01-app",
      acp_session_id: "acp-resumed",
    });

    const session = getSession("sess-worktree-roots");
    expect(session).toMatchObject({
      cwd: "/managed/worktrees/sess-worktree-roots/01-app",
      additional_directories: [
        "/managed/worktrees/sess-worktree-roots/02-docs",
      ],
    });
    const created = new Date(session!.created_at);
    const metadataPath = join(
      root,
      "transcripts",
      String(created.getUTCFullYear()),
      String(created.getUTCMonth() + 1).padStart(2, "0"),
      String(created.getUTCDate()).padStart(2, "0"),
      "sess-worktree-roots.meta.toml",
    );
    expect(parseToml(await readFile(metadataPath, "utf8"))).toMatchObject({
      additional_directories: [
        "/managed/worktrees/sess-worktree-roots/02-docs",
      ],
    });
  });

  it("distinguishes an explicitly single-root session from a legacy row", () => {
    upsertSession({
      id: "sess-worktree-single",
      agent_id: "codex-acp",
      cwd: "/managed/worktrees/sess-worktree-single/01-app",
      additional_directories: [],
    });
    upsertSession({
      id: "sess-legacy",
      agent_id: "codex-acp",
      cwd: "/source/legacy",
    });

    expect(getSession("sess-worktree-single")?.additional_directories).toEqual([]);
    expect(getSession("sess-legacy")?.additional_directories).toBeNull();
  });
});
