import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  listPairGroups,
  listSessions,
  openSessionDb,
  savePairGroup,
  setPairTitleIfEmpty,
  touchPairSession,
  upsertPairSession,
} from "./sql-store";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("sql-store pair metadata write-through", () => {
  it("writes pair wrapper metadata to a TOML sidecar", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-sql-store-pair-"));
    tempRoots.push(root);
    const createdAt = Date.UTC(2026, 5, 14, 11, 0, 0);
    const touchedAt = createdAt + 5_000;
    vi.useFakeTimers();
    vi.setSystemTime(createdAt);

    openSessionDb(join(root, "sessions.db"));
    upsertPairSession({
      id: "pair_file_first",
      workspace_cwd: join(root, "workspace"),
    });

    vi.setSystemTime(touchedAt);
    setPairTitleIfEmpty("pair_file_first", "Pair file-first sidecar");
    touchPairSession("pair_file_first");

    const metadataPath = join(
      root,
      "transcripts",
      "2026",
      "06",
      "14",
      "pair_file_first.pair.meta.toml",
    );
    const metadata = parseToml(await readFile(metadataPath, "utf-8")) as Record<
      string,
      unknown
    >;

    expect(metadata).toMatchObject({
      schema_version: "backchat.pair_session_meta.v1",
      pair_id: "pair_file_first",
      title: "Pair file-first sidecar",
      workspace_cwd: join(root, "workspace"),
      created_at: createdAt,
      last_used_at: touchedAt,
    });
    expect(metadata).not.toHaveProperty("archived_at");
    expect(metadata).not.toHaveProperty("pinned_at");

    savePairGroup({
      id: "pair_file_first",
      title: "Pair file-first sidecar",
      workspace_cwd: join(root, "workspace"),
      members: [
        {
          id: "sess_pair_codex",
          agent_id: "codex-acp",
          cwd: join(root, "workspace"),
        },
        {
          id: "sess_pair_claude",
          agent_id: "claude-acp",
          cwd: join(root, "workspace"),
        },
      ],
    });

    expect(listPairGroups()).toEqual([
      expect.objectContaining({
        id: "pair_file_first",
        title: "Pair file-first sidecar",
        members: [
          expect.objectContaining({
            id: "sess_pair_codex",
            agent_id: "codex-acp",
            pair_id: "pair_file_first",
          }),
          expect.objectContaining({
            id: "sess_pair_claude",
            agent_id: "claude-acp",
            pair_id: "pair_file_first",
          }),
        ],
      }),
    ]);
    expect(listSessions()).toEqual([]);
  });
});
