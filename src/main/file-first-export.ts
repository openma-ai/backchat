import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stringify as toToml } from "smol-toml";

export interface ExportSessionFilesOptions {
  dbPath: string;
  outputRoot: string;
  now?: () => number;
  overwrite?: boolean;
}

export interface ExportedSessionFile {
  sessionId: string;
  eventCount: number;
  transcriptPath: string;
  metadataPath: string;
  skipped: boolean;
}

export interface ExportedPairSessionFile {
  pairId: string;
  metadataPath: string;
  skipped: boolean;
}

export interface ExportSessionFilesResult {
  sessions: ExportedSessionFile[];
  pairs: ExportedPairSessionFile[];
}

export async function exportSessionFiles(
  options: ExportSessionFilesOptions,
): Promise<ExportSessionFilesResult> {
  const now = options.now ?? Date.now;
  const db = new DatabaseSync(options.dbPath, { readOnly: true });
  try {
    const sessions = db.prepare(`
      SELECT
        id,
        agent_id,
        cwd,
        acp_session_id,
        title,
        last_used_at,
        created_at,
        archived_at,
        pinned_at,
        pair_id
      FROM sessions
      ORDER BY created_at ASC, id ASC
    `).all() as unknown as PersistedSessionRow[];

    const readEvents = db.prepare(`
      SELECT seq, type, data, ts
      FROM events
      WHERE session_id = ?
      ORDER BY seq ASC
    `);
    const pairs = tableExists(db, "pair_sessions")
      ? db.prepare(`
          SELECT
            id,
            title,
            workspace_cwd,
            created_at,
            last_used_at,
            archived_at,
            pinned_at
          FROM pair_sessions
          ORDER BY created_at ASC, id ASC
        `).all() as unknown as PersistedPairSessionRow[]
      : [];

    const exported: ExportedSessionFile[] = [];
    for (const session of sessions) {
      const events = readEvents.all(session.id) as unknown as PersistedEventRow[];
      const dir = join(options.outputRoot, "transcripts", ...dateParts(session.created_at));
      const transcriptPath = join(dir, `${session.id}.jsonl`);
      const metadataPath = join(dir, `${session.id}.meta.toml`);

      await mkdir(dir, { recursive: true });
      const transcriptExists = existsSync(transcriptPath);
      const metadataExists = existsSync(metadataPath);
      if (
        !options.overwrite &&
        transcriptExists &&
        metadataExists
      ) {
        exported.push({
          sessionId: session.id,
          eventCount: events.length,
          transcriptPath,
          metadataPath,
          skipped: true,
        });
        continue;
      }

      if (options.overwrite || !transcriptExists) {
        await writeAtomic(
          transcriptPath,
          events.map((event, index) =>
            JSON.stringify(toSessionEvent(session.id, event, index + 1)),
          ).join("\n") +
            (events.length > 0 ? "\n" : ""),
        );
      }
      if (options.overwrite || !metadataExists) {
        await writeAtomic(
          metadataPath,
          toToml({
            schema_version: "backchat.session_meta.v1",
            session_id: session.id,
            agent_id: session.agent_id,
            acp_session_id: session.acp_session_id,
            title: session.title,
            created_at: session.created_at,
            last_used_at: session.last_used_at,
            pair_id: session.pair_id ?? "",
            workdir: session.cwd,
            exported_at: now(),
          }) + "\n",
        );
      }

      exported.push({
        sessionId: session.id,
        eventCount: events.length,
        transcriptPath,
        metadataPath,
        skipped: false,
      });
    }

    const exportedPairs: ExportedPairSessionFile[] = [];
    for (const pair of pairs) {
      const dir = join(options.outputRoot, "transcripts", ...dateParts(pair.created_at));
      const metadataPath = join(dir, `${pair.id}.pair.meta.toml`);
      await mkdir(dir, { recursive: true });

      if (!options.overwrite && existsSync(metadataPath)) {
        exportedPairs.push({
          pairId: pair.id,
          metadataPath,
          skipped: true,
        });
        continue;
      }

      await writeAtomic(
        metadataPath,
        toToml({
          schema_version: "backchat.pair_session_meta.v1",
          pair_id: pair.id,
          title: pair.title,
          workspace_cwd: pair.workspace_cwd,
          created_at: pair.created_at,
          last_used_at: pair.last_used_at,
          exported_at: now(),
        }) + "\n",
      );

      exportedPairs.push({
        pairId: pair.id,
        metadataPath,
        skipped: false,
      });
    }

    return { sessions: exported, pairs: exportedPairs };
  } finally {
    db.close();
  }
}

interface PersistedSessionRow {
  id: string;
  agent_id: string;
  cwd: string;
  acp_session_id: string;
  title: string;
  last_used_at: number;
  created_at: number;
  archived_at: number | null;
  pinned_at: number | null;
  pair_id: string | null;
}

interface PersistedEventRow {
  seq: number;
  type: string;
  data: string;
  ts: number;
}

interface PersistedPairSessionRow {
  id: string;
  title: string;
  workspace_cwd: string;
  created_at: number;
  last_used_at: number;
  archived_at: number | null;
  pinned_at: number | null;
}

function toSessionEvent(
  sessionId: string,
  row: PersistedEventRow,
  transcriptSeq: number,
): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(row.data);
  } catch (e) {
    throw new Error(`invalid event JSON for session ${sessionId} seq ${transcriptSeq}`, {
      cause: e,
    });
  }

  return {
    schema_version: "backchat.session_event.v1",
    seq: transcriptSeq,
    type: row.type,
    ts: row.ts,
    data,
    source: "desktop",
  };
}

function dateParts(ms: number): [string, string, string] {
  const d = new Date(ms);
  return [
    String(d.getUTCFullYear()),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ];
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db.prepare(
    `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
  ).get(tableName) as { ok: number } | undefined;
  return row?.ok === 1;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, path);
}
