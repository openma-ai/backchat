import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stringify as toToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import { rebuildSessionIndexFromTranscriptFiles } from "./file-first-rebuild";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("file-first rebuild", () => {
  it("imports every event from multiple transcripts with overlapping file seq", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-rebuild-"));
    tempRoots.push(root);
    await writeSessionFiles(root, {
      sessionId: "sess_a",
      title: "First rebuilt chat",
      events: [
        { seq: 1, type: "user_prompt", ts: 1_781_424_001_000, data: { text: "alpha" } },
        { seq: 2, type: "agent_message", ts: 1_781_424_002_000, data: { text: "bravo" } },
      ],
    });
    await writeSessionFiles(root, {
      sessionId: "sess_b",
      title: "Second rebuilt chat",
      events: [
        { seq: 1, type: "user_prompt", ts: 1_781_424_003_000, data: { text: "charlie" } },
        { seq: 2, type: "agent_message", ts: 1_781_424_004_000, data: { text: "delta" } },
      ],
    });

    const db = openEmptyIndex();
    try {
      const result = rebuildSessionIndexFromTranscriptFiles(db, root);

      expect(result).toMatchObject({
        sessionsImported: 2,
        eventsImported: 4,
        diagnostics: [],
      });
      expect(
        db.prepare(`SELECT session_id, type, data FROM events ORDER BY session_id, seq`).all(),
      ).toEqual([
        {
          session_id: "sess_a",
          type: "user_prompt",
          data: JSON.stringify({ text: "alpha" }),
        },
        {
          session_id: "sess_a",
          type: "agent_message",
          data: JSON.stringify({ text: "bravo" }),
        },
        {
          session_id: "sess_b",
          type: "user_prompt",
          data: JSON.stringify({ text: "charlie" }),
        },
        {
          session_id: "sess_b",
          type: "agent_message",
          data: JSON.stringify({ text: "delta" }),
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("imports pair wrapper sidecars and linked member sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-rebuild-"));
    tempRoots.push(root);
    const pairId = "pair_rebuild";
    await writePairMeta(root, {
      pairId,
      title: "Pair rebuild title",
      workspaceCwd: "/tmp/pair-workspace",
    });
    await writeSessionFiles(root, {
      sessionId: "member_one",
      title: "Member one",
      pairId,
      events: [
        { seq: 1, type: "user_prompt", ts: 1_781_424_001_000, data: { text: "pair hello" } },
      ],
    });

    const db = openEmptyIndex();
    try {
      const result = rebuildSessionIndexFromTranscriptFiles(db, root);

      expect(result).toMatchObject({
        pairsImported: 1,
        sessionsImported: 1,
        eventsImported: 1,
        diagnostics: [],
      });
      expect(db.prepare(`SELECT * FROM pair_sessions`).all()).toMatchObject([
        {
          id: pairId,
          title: "Pair rebuild title",
          workspace_cwd: "/tmp/pair-workspace",
        },
      ]);
      expect(
        db.prepare(`SELECT id, pair_id FROM sessions WHERE id = 'member_one'`).get(),
      ).toEqual({
        id: "member_one",
        pair_id: pairId,
      });
    } finally {
      db.close();
    }
  });

  it("ignores archive and pin fields from legacy sidecars", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-rebuild-"));
    tempRoots.push(root);
    await writeSessionFiles(root, {
      sessionId: "sess_legacy_ui_state",
      title: "Legacy UI state sidecar",
      archivedAt: 1_781_424_090_000,
      pinnedAt: 1_781_424_080_000,
      events: [
        { seq: 1, type: "user_prompt", ts: 1_781_424_001_000, data: { text: "legacy" } },
      ],
    });
    await writePairMeta(root, {
      pairId: "pair_legacy_ui_state",
      title: "Legacy pair UI state",
      workspaceCwd: "/tmp/legacy-pair",
      archivedAt: 1_781_424_090_000,
      pinnedAt: 1_781_424_080_000,
    });

    const db = openEmptyIndex();
    try {
      rebuildSessionIndexFromTranscriptFiles(db, root);

      expect(
        db.prepare(`
          SELECT archived_at, pinned_at FROM sessions WHERE id = 'sess_legacy_ui_state'
        `).get(),
      ).toEqual({ archived_at: null, pinned_at: null });
      expect(
        db.prepare(`
          SELECT archived_at, pinned_at FROM pair_sessions WHERE id = 'pair_legacy_ui_state'
        `).get(),
      ).toEqual({ archived_at: null, pinned_at: null });
    } finally {
      db.close();
    }
  });
});

function openEmptyIndex(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      acp_session_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      last_used_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      archived_at INTEGER,
      pinned_at INTEGER,
      pair_id TEXT
    );
    CREATE TABLE pair_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      workspace_cwd TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      archived_at INTEGER,
      pinned_at INTEGER
    );
    CREATE TABLE events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);
  return db;
}

async function writeSessionFiles(
  root: string,
  opts: {
    sessionId: string;
    title: string;
    archivedAt?: number;
    pinnedAt?: number;
    pairId?: string;
    events: Array<{ seq: number; type: string; ts: number; data: unknown }>;
  },
): Promise<void> {
  const dir = join(root, "transcripts", "2026", "06", "14");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${opts.sessionId}.meta.toml`),
    toToml({
      schema_version: "backchat.session_meta.v1",
      session_id: opts.sessionId,
      agent_id: "codex-acp",
      acp_session_id: `acp-${opts.sessionId}`,
      title: opts.title,
      created_at: 1_781_424_000_000,
      last_used_at: 1_781_424_100_000,
      archived_at: opts.archivedAt ?? 0,
      pinned_at: opts.pinnedAt ?? 0,
      pair_id: opts.pairId ?? "",
      workdir: `/tmp/${opts.sessionId}`,
    }) + "\n",
    "utf-8",
  );
  await writeFile(
    join(dir, `${opts.sessionId}.jsonl`),
    opts.events.map((event) =>
      JSON.stringify({
        schema_version: "backchat.session_event.v1",
        ...event,
        source: "desktop",
      }),
    ).join("\n") + "\n",
    "utf-8",
  );
}

async function writePairMeta(
  root: string,
  opts: {
    pairId: string;
    title: string;
    workspaceCwd: string;
    archivedAt?: number;
    pinnedAt?: number;
  },
): Promise<void> {
  const dir = join(root, "transcripts", "2026", "06", "14");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${opts.pairId}.pair.meta.toml`),
    toToml({
      schema_version: "backchat.pair_session_meta.v1",
      pair_id: opts.pairId,
      title: opts.title,
      workspace_cwd: opts.workspaceCwd,
      created_at: 1_781_424_000_000,
      last_used_at: 1_781_424_100_000,
      archived_at: opts.archivedAt ?? 0,
      pinned_at: opts.pinnedAt ?? 0,
    }) + "\n",
    "utf-8",
  );
}
