import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { exportSessionFiles } from "./file-first-export";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("exportSessionFiles", () => {
  it("exports session metadata and events as transcript files", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-export-"));
    tempRoots.push(root);
    const dbPath = join(root, "sessions.db");
    const outputRoot = join(root, "out");
    seedSessionDb(dbPath);

    const result = await exportSessionFiles({
      dbPath,
      outputRoot,
      now: () => 1_781_500_000_000,
    });

    expect(result.sessions).toEqual([
      {
        sessionId: "sess_export",
        eventCount: 2,
        transcriptPath: join(outputRoot, "transcripts", "2026", "06", "14", "sess_export.jsonl"),
        metadataPath: join(outputRoot, "transcripts", "2026", "06", "14", "sess_export.meta.toml"),
        skipped: false,
      },
    ]);

    const transcript = await readFile(result.sessions[0]!.transcriptPath, "utf-8");
    expect(transcript.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      {
        schema_version: "backchat.session_event.v1",
        seq: 1,
        type: "user_prompt",
        ts: 1_781_424_000_000,
        data: { text: "Plan file-first storage." },
        source: "desktop",
      },
      {
        schema_version: "backchat.session_event.v1",
        seq: 2,
        type: "agent_message",
        ts: 1_781_424_005_000,
        data: { text: "Here is a plan..." },
        source: "desktop",
      },
    ]);

    const metadata = parseToml(
      await readFile(result.sessions[0]!.metadataPath, "utf-8"),
    ) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      schema_version: "backchat.session_meta.v1",
      session_id: "sess_export",
      agent_id: "codex-acp",
      acp_session_id: "acp_123",
      title: "Plan file-first storage",
      created_at: 1_781_424_000_000,
      last_used_at: 1_781_424_100_000,
      pair_id: "",
      workdir: "/tmp/work",
      exported_at: 1_781_500_000_000,
    });
    expect(metadata).not.toHaveProperty("archived_at");
    expect(metadata).not.toHaveProperty("pinned_at");
  });

  it("renumbers exported event seq within each transcript file", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-export-"));
    tempRoots.push(root);
    const dbPath = join(root, "sessions.db");
    const outputRoot = join(root, "out");
    seedSessionDb(dbPath, { withSecondSession: true });

    const result = await exportSessionFiles({ dbPath, outputRoot });

    expect(result.sessions.map((session) => session.sessionId)).toEqual([
      "sess_export",
      "sess_export_second",
    ]);
    const firstTranscript = await readJsonl(result.sessions[0]!.transcriptPath);
    const secondTranscript = await readJsonl(result.sessions[1]!.transcriptPath);
    expect(firstTranscript.map((event) => event.seq)).toEqual([1, 2]);
    expect(secondTranscript.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("skips existing transcript files unless overwrite is requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-export-"));
    tempRoots.push(root);
    const dbPath = join(root, "sessions.db");
    const outputRoot = join(root, "out");
    seedSessionDb(dbPath);

    await exportSessionFiles({ dbPath, outputRoot });
    const firstTranscriptPath = join(
      outputRoot,
      "transcripts",
      "2026",
      "06",
      "14",
      "sess_export.jsonl",
    );

    const skipped = await exportSessionFiles({ dbPath, outputRoot });
    expect(skipped.sessions).toEqual([
      {
        sessionId: "sess_export",
        eventCount: 2,
        transcriptPath: firstTranscriptPath,
        metadataPath: join(
          outputRoot,
          "transcripts",
          "2026",
          "06",
          "14",
          "sess_export.meta.toml",
        ),
        skipped: true,
      },
    ]);

    const overwritten = await exportSessionFiles({ dbPath, outputRoot, overwrite: true });
    expect(overwritten.sessions[0]?.skipped).toBe(false);
  });

  it("fills a missing transcript when metadata already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-export-"));
    tempRoots.push(root);
    const dbPath = join(root, "sessions.db");
    const outputRoot = join(root, "out");
    seedSessionDb(dbPath);
    const dir = join(outputRoot, "transcripts", "2026", "06", "14");
    const metadataPath = join(dir, "sess_export.meta.toml");
    await mkdir(dir, { recursive: true });
    await writeFile(metadataPath, "user_kept = true\n", "utf-8");

    const result = await exportSessionFiles({ dbPath, outputRoot });

    expect(result.sessions[0]).toMatchObject({
      sessionId: "sess_export",
      skipped: false,
    });
    const transcript = await readFile(join(dir, "sess_export.jsonl"), "utf-8");
    expect(transcript).toContain('"schema_version":"backchat.session_event.v1"');
    await expect(readFile(metadataPath, "utf-8")).resolves.toBe("user_kept = true\n");
  });

  it("reports the session and seq when an event JSON payload is invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-export-"));
    tempRoots.push(root);
    const dbPath = join(root, "sessions.db");
    seedSessionDb(dbPath, { invalidFirstEventJson: true });

    await expect(
      exportSessionFiles({ dbPath, outputRoot: join(root, "out") }),
    ).rejects.toThrow("invalid event JSON for session sess_export seq 1");
  });

  it("exports pair-session wrapper metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-export-"));
    tempRoots.push(root);
    const dbPath = join(root, "sessions.db");
    const outputRoot = join(root, "out");
    seedSessionDb(dbPath, { withPairSession: true });

    const result = await exportSessionFiles({
      dbPath,
      outputRoot,
      now: () => 1_781_500_000_000,
    });

    expect(result.pairs).toEqual([
      {
        pairId: "pair_export",
        metadataPath: join(
          outputRoot,
          "transcripts",
          "2026",
          "06",
          "14",
          "pair_export.pair.meta.toml",
        ),
        skipped: false,
      },
    ]);

    const metadata = parseToml(
      await readFile(result.pairs[0]!.metadataPath, "utf-8"),
    ) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      schema_version: "backchat.pair_session_meta.v1",
      pair_id: "pair_export",
      title: "Pair planning",
      workspace_cwd: "/tmp/shared",
      created_at: 1_781_424_000_000,
      last_used_at: 1_781_424_300_000,
      exported_at: 1_781_500_000_000,
    });
    expect(metadata).not.toHaveProperty("archived_at");
    expect(metadata).not.toHaveProperty("pinned_at");
  });

  it("treats a missing pair_sessions table as no pair metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-file-export-"));
    tempRoots.push(root);
    const dbPath = join(root, "sessions.db");
    seedSessionDb(dbPath, { omitPairTable: true });

    const result = await exportSessionFiles({
      dbPath,
      outputRoot: join(root, "out"),
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.pairs).toEqual([]);
  });
});

function seedSessionDb(
  dbPath: string,
  opts: {
    invalidFirstEventJson?: boolean;
    withSecondSession?: boolean;
    withPairSession?: boolean;
    omitPairTable?: boolean;
  } = {},
): void {
  const db = new DatabaseSync(dbPath);
  try {
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
      CREATE TABLE events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
    `);
    if (!opts.omitPairTable) {
      db.exec(`
        CREATE TABLE pair_sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          workspace_cwd TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          last_used_at INTEGER NOT NULL,
          archived_at INTEGER,
          pinned_at INTEGER
        );
      `);
    }
    db.prepare(`
      INSERT INTO sessions (
        id, agent_id, cwd, acp_session_id, title, last_used_at, created_at,
        archived_at, pinned_at, pair_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sess_export",
      "codex-acp",
      "/tmp/work",
      "acp_123",
      "Plan file-first storage",
      1_781_424_100_000,
      1_781_424_000_000,
      null,
      1_781_424_200_000,
      null,
    );
    db.prepare(
      `INSERT INTO events (session_id, type, data, ts) VALUES (?, ?, ?, ?)`,
    ).run(
      "sess_export",
      "user_prompt",
      opts.invalidFirstEventJson
        ? "{not valid json"
        : JSON.stringify({ text: "Plan file-first storage." }),
      1_781_424_000_000,
    );
    db.prepare(
      `INSERT INTO events (session_id, type, data, ts) VALUES (?, ?, ?, ?)`,
    ).run(
      "sess_export",
      "agent_message",
      JSON.stringify({ text: "Here is a plan..." }),
      1_781_424_005_000,
    );
    if (opts.withSecondSession) {
      db.prepare(`
        INSERT INTO sessions (
          id, agent_id, cwd, acp_session_id, title, last_used_at, created_at,
          archived_at, pinned_at, pair_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "sess_export_second",
        "codex-acp",
        "/tmp/work-two",
        "acp_456",
        "Second file-first export",
        1_781_424_120_000,
        1_781_424_010_000,
        null,
        null,
        null,
      );
      db.prepare(
        `INSERT INTO events (session_id, type, data, ts) VALUES (?, ?, ?, ?)`,
      ).run(
        "sess_export_second",
        "user_prompt",
        JSON.stringify({ text: "Second export prompt." }),
        1_781_424_010_000,
      );
      db.prepare(
        `INSERT INTO events (session_id, type, data, ts) VALUES (?, ?, ?, ?)`,
      ).run(
        "sess_export_second",
        "agent_message",
        JSON.stringify({ text: "Second export answer." }),
        1_781_424_015_000,
      );
    }
    if (opts.withPairSession) {
      db.prepare(`
        INSERT INTO pair_sessions (
          id, title, workspace_cwd, created_at, last_used_at, archived_at, pinned_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "pair_export",
        "Pair planning",
        "/tmp/shared",
        1_781_424_000_000,
        1_781_424_300_000,
        null,
        null,
      );
    }
  } finally {
    db.close();
  }
}

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(path, "utf-8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
