import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type DatabaseSync } from "node:sqlite";
import { parse as parseToml } from "smol-toml";

export interface RebuildSessionIndexResult {
  pairsImported: number;
  sessionsImported: number;
  eventsImported: number;
  diagnostics: string[];
}

interface SessionMetaFile {
  sessionId: string;
  agentId: string;
  cwd: string;
  acpSessionId: string;
  title: string;
  createdAt: number;
  lastUsedAt: number;
  archivedAt: number | null;
  pinnedAt: number | null;
  pairId: string | null;
  metadataPath: string;
  transcriptPath: string;
}

interface PairMetaFile {
  pairId: string;
  title: string;
  workspaceCwd: string;
  createdAt: number;
  lastUsedAt: number;
  archivedAt: number | null;
  pinnedAt: number | null;
}

export function rebuildSessionIndexFromTranscriptFiles(
  db: DatabaseSync,
  root: string,
): RebuildSessionIndexResult {
  const transcriptsRoot = join(root, "transcripts");
  const diagnostics: string[] = [];
  if (!existsSync(transcriptsRoot)) {
    return { pairsImported: 0, sessionsImported: 0, eventsImported: 0, diagnostics };
  }

  const metas = findSessionMetaFiles(transcriptsRoot)
    .map((path) => readSessionMeta(path, root, diagnostics))
    .filter((meta): meta is SessionMetaFile => meta !== null);
  const pairMetas = findPairMetaFiles(transcriptsRoot)
    .map((path) => readPairMeta(path, diagnostics))
    .filter((meta): meta is PairMetaFile => meta !== null);
  if (metas.length === 0 && pairMetas.length === 0) {
    return { pairsImported: 0, sessionsImported: 0, eventsImported: 0, diagnostics };
  }

  const pairExists = db.prepare(`SELECT 1 AS ok FROM pair_sessions WHERE id = ? LIMIT 1`);
  const insertPair = db.prepare(`
    INSERT OR IGNORE INTO pair_sessions (
      id,
      title,
      workspace_cwd,
      created_at,
      last_used_at,
      archived_at,
      pinned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const sessionExists = db.prepare(`SELECT 1 AS ok FROM sessions WHERE id = ? LIMIT 1`);
  const eventCount = db.prepare(`SELECT COUNT(*) AS count FROM events WHERE session_id = ?`);
  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO sessions (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO events (session_id, type, data, ts)
    VALUES (?, ?, ?, ?)
  `);

  let pairsImported = 0;
  let sessionsImported = 0;
  let eventsImported = 0;

  db.exec("BEGIN");
  try {
    for (const pair of pairMetas) {
      const alreadyHadPair =
        (pairExists.get(pair.pairId) as { ok: number } | undefined)?.ok === 1;
      insertPair.run(
        pair.pairId,
        pair.title,
        pair.workspaceCwd,
        pair.createdAt,
        pair.lastUsedAt,
        pair.archivedAt,
        pair.pinnedAt,
      );
      if (!alreadyHadPair) pairsImported += 1;
    }

    for (const meta of metas) {
      const alreadyHadSession =
        (sessionExists.get(meta.sessionId) as { ok: number } | undefined)?.ok === 1;
      insertSession.run(
        meta.sessionId,
        meta.agentId,
        meta.cwd,
        meta.acpSessionId,
        meta.title,
        meta.lastUsedAt,
        meta.createdAt,
        meta.archivedAt,
        meta.pinnedAt,
        meta.pairId,
      );
      if (!alreadyHadSession) sessionsImported += 1;

      const existingEvents = eventCount.get(meta.sessionId) as { count: number };
      if (Number(existingEvents.count) > 0) continue;
      for (const event of readTranscriptEvents(meta, diagnostics)) {
        insertEvent.run(
          meta.sessionId,
          event.type,
          JSON.stringify(event.data),
          event.ts,
        );
        eventsImported += 1;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { pairsImported, sessionsImported, eventsImported, diagnostics };
}

function findSessionMetaFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...findSessionMetaFiles(path));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".meta.toml") &&
      !entry.name.endsWith(".pair.meta.toml")
    ) {
      out.push(path);
    }
  }
  return out.sort();
}

function findPairMetaFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...findPairMetaFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".pair.meta.toml")) {
      out.push(path);
    }
  }
  return out.sort();
}

function readSessionMeta(
  metadataPath: string,
  root: string,
  diagnostics: string[],
): SessionMetaFile | null {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    diagnostics.push(`${metadataPath}: invalid TOML (${(e as Error).message})`);
    return null;
  }

  if (raw["schema_version"] !== "backchat.session_meta.v1") {
    diagnostics.push(`${metadataPath}: unsupported session metadata schema`);
    return null;
  }

  const sessionId = stringField(raw, "session_id");
  const agentId = stringField(raw, "agent_id");
  if (!sessionId || !agentId) {
    diagnostics.push(`${metadataPath}: missing session_id or agent_id`);
    return null;
  }

  const createdAt = numberField(raw, "created_at", Date.now());
  const lastUsedAt = numberField(raw, "last_used_at", createdAt);
  const transcriptPath = metadataPath.replace(/\.meta\.toml$/, ".jsonl");

  return {
    sessionId,
    agentId,
    cwd: stringField(raw, "workdir") || join(root, "sessions", sessionId),
    acpSessionId: stringField(raw, "acp_session_id"),
    title: stringField(raw, "title"),
    createdAt,
    lastUsedAt,
    archivedAt: null,
    pinnedAt: null,
    pairId: stringField(raw, "pair_id") || null,
    metadataPath,
    transcriptPath,
  };
}

function readPairMeta(
  metadataPath: string,
  diagnostics: string[],
): PairMetaFile | null {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    diagnostics.push(`${metadataPath}: invalid TOML (${(e as Error).message})`);
    return null;
  }

  if (raw["schema_version"] !== "backchat.pair_session_meta.v1") {
    diagnostics.push(`${metadataPath}: unsupported pair metadata schema`);
    return null;
  }

  const pairId = stringField(raw, "pair_id");
  if (!pairId) {
    diagnostics.push(`${metadataPath}: missing pair_id`);
    return null;
  }
  const createdAt = numberField(raw, "created_at", Date.now());

  return {
    pairId,
    title: stringField(raw, "title"),
    workspaceCwd: stringField(raw, "workspace_cwd"),
    createdAt,
    lastUsedAt: numberField(raw, "last_used_at", createdAt),
    archivedAt: null,
    pinnedAt: null,
  };
}

function readTranscriptEvents(
  meta: SessionMetaFile,
  diagnostics: string[],
): Array<{ seq: number; type: string; data: unknown; ts: number }> {
  if (!existsSync(meta.transcriptPath)) {
    diagnostics.push(`${meta.transcriptPath}: missing transcript for ${meta.sessionId}`);
    return [];
  }

  const out: Array<{ seq: number; type: string; data: unknown; ts: number }> = [];
  const lines = readFileSync(meta.transcriptPath, "utf-8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch (e) {
      diagnostics.push(`${meta.transcriptPath}:${i + 1}: invalid JSON (${(e as Error).message})`);
      continue;
    }

    const seq = numberField(raw, "seq", 0);
    const type = stringField(raw, "type");
    if (seq <= 0 || !type) {
      diagnostics.push(`${meta.transcriptPath}:${i + 1}: missing seq or type`);
      continue;
    }
    out.push({
      seq,
      type,
      ts: numberField(raw, "ts", meta.lastUsedAt),
      data: Object.hasOwn(raw, "data") ? raw["data"] : {},
    });
  }
  return out;
}

function stringField(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value : "";
}

function numberField(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableTimestamp(raw: Record<string, unknown>, key: string): number | null {
  const value = numberField(raw, key, 0);
  return value > 0 ? value : null;
}
