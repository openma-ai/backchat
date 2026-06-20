import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  appendEvent,
  archiveSession,
  loadHistory,
  openSessionDb,
  pinSession,
  setSessionTitleIfEmpty,
  upsertSession,
} from "./sql-store";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("sql-store file-first write-through", () => {
  it("writes appended events to a session transcript JSONL file", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-sql-store-"));
    tempRoots.push(root);
    const now = Date.UTC(2026, 5, 14, 10, 30, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    openSessionDb(join(root, "sessions.db"));
    upsertSession({
      id: "sess_file_first",
      agent_id: "codex-acp",
      cwd: join(root, "sessions", "sess_file_first"),
      acp_session_id: "acp_file_first",
      title: "",
    });
    setSessionTitleIfEmpty("sess_file_first", "File-first write-through");
    pinSession("sess_file_first", now + 1_000);
    archiveSession("sess_file_first");

    const metadataPath = join(
      root,
      "transcripts",
      "2026",
      "06",
      "14",
      "sess_file_first.meta.toml",
    );
    const metadata = parseToml(await readFile(metadataPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(metadata).toMatchObject({
      schema_version: "backchat.session_meta.v1",
      session_id: "sess_file_first",
      agent_id: "codex-acp",
      acp_session_id: "acp_file_first",
      title: "File-first write-through",
      created_at: now,
      last_used_at: now,
      workdir: join(root, "sessions", "sess_file_first"),
      pair_id: "",
    });
    expect(metadata).not.toHaveProperty("archived_at");
    expect(metadata).not.toHaveProperty("pinned_at");

    appendEvent("sess_file_first", "user_prompt", { text: "hello files" });
    upsertSession({
      id: "sess_file_second",
      agent_id: "codex-acp",
      cwd: join(root, "sessions", "sess_file_second"),
      title: "Second file-first write-through",
    });
    appendEvent("sess_file_second", "user_prompt", { text: "hello second files" });

    expect(loadHistory("sess_file_first")).toHaveLength(1);
    const transcript = await readFile(
      join(root, "transcripts", "2026", "06", "14", "sess_file_first.jsonl"),
      "utf-8",
    );
    expect(transcript.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      {
        schema_version: "backchat.session_event.v1",
        seq: 1,
        type: "user_prompt",
        ts: now,
        data: { text: "hello files" },
        source: "desktop",
      },
    ]);
    const secondTranscript = await readFile(
      join(root, "transcripts", "2026", "06", "14", "sess_file_second.jsonl"),
      "utf-8",
    );
    expect(secondTranscript.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      {
        schema_version: "backchat.session_event.v1",
        seq: 1,
        type: "user_prompt",
        ts: now,
        data: { text: "hello second files" },
        source: "desktop",
      },
    ]);
  });
});
