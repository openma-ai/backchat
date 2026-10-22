import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  appendEvent,
  archiveSession,
  closeSessionDb,
  eventIndexStatus,
  explainEventQueryPlans,
  latestOpenMAEventSequence,
  getSession,
  loadHistory,
  loadHistoryPage,
  openSessionDb,
  pinSession,
  searchMessages,
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
    expect(getSession("sess_file_first")).toMatchObject({
      id: "sess_file_first",
      agent_id: "codex-acp",
      acp_session_id: "acp_file_first",
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
    expect(metadata).toMatchObject({
      parent_session_id: "",
      fork_kind: "",
    });

    upsertSession({
      id: "sess_fork_child",
      agent_id: "pi-acp",
      cwd: join(root, "sessions", "sess_fork_child"),
      acp_session_id: "acp_fork_child",
      title: "Forked chat",
      parent_session_id: "sess_file_first",
      fork_kind: "message",
    });
    expect(getSession("sess_fork_child")).toMatchObject({
      parent_session_id: "sess_file_first",
      fork_kind: "message",
    });
    const childMetadata = parseToml(await readFile(
      join(root, "transcripts", "2026", "06", "14", "sess_fork_child.meta.toml"),
      "utf-8",
    )) as Record<string, unknown>;
    expect(childMetadata).toMatchObject({
      parent_session_id: "sess_file_first",
      fork_kind: "message",
      workdir: join(root, "sessions", "sess_fork_child"),
    });
    upsertSession({
      id: "sess_fork_child",
      agent_id: "pi-acp",
      cwd: join(root, "sessions", "sess_fork_child"),
      acp_session_id: "acp_fork_child",
    });
    expect(getSession("sess_fork_child")).toMatchObject({
      parent_session_id: "sess_file_first",
      fork_kind: "message",
    });

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

    const canonicalEvent = {
      schema_version: "oma.event.v1",
      event_id: "canonical-search-event",
      type: "agent.message_chunk",
      session_id: "sess_file_first",
      turn_id: "turn-search",
      source: { kind: "harness", harness: "codex-acp", adapter: "acp" },
      occurred_at: new Date(now).toISOString(),
      data: { text: "canonical lookup" },
    };
    appendEvent("sess_file_first", "openma_event", canonicalEvent);
    // Renderer-derived canonical events may race with a retry across the
    // host boundary. The event id is the idempotency key and must not create
    // a second SQL/transcript row.
    appendEvent("sess_file_first", "openma_event", canonicalEvent);
    expect(
      loadHistory("sess_file_first").filter((row) => row.type === "openma_event"),
    ).toHaveLength(1);
    expect(searchMessages("canonical lookup")).toEqual([
      expect.objectContaining({
        session_id: "sess_file_first",
        type: "openma_event",
        snippet: expect.stringContaining("canonical"),
      }),
    ]);
  });


  it("pages history from the tail in seq order", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-sql-store-page-"));
    tempRoots.push(root);
    openSessionDb(join(root, "sessions.db"));
    upsertSession({
      id: "sess_page",
      agent_id: "codex-acp",
      cwd: join(root, "sessions", "sess_page"),
      acp_session_id: "acp_page",
      title: "",
    });
    for (let i = 0; i < 7; i++) {
      appendEvent("sess_page", "user_prompt", { text: `p${i}` });
    }
    const all = loadHistory("sess_page");
    // seq is a store-wide autoincrement, so assert relative to what was stored.
    const seq = all.map((r) => r.seq);
    expect(seq).toHaveLength(7);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
    // No limit keeps the full-log contract used by e2e and the MCP bridge.
    expect(loadHistoryPage("sess_page")).toEqual(all);
    // Tail window, ascending.
    expect(loadHistoryPage("sess_page", { limit: 3 }).map((r) => r.seq)).toEqual(seq.slice(4));
    // Older page, strictly before the given seq.
    expect(
      loadHistoryPage("sess_page", { before_seq: seq[4], limit: 3 }).map((r) => r.seq),
    ).toEqual(seq.slice(1, 4));
    // Final short page, then empty.
    expect(
      loadHistoryPage("sess_page", { before_seq: seq[1], limit: 3 }).map((r) => r.seq),
    ).toEqual(seq.slice(0, 1));
    expect(loadHistoryPage("sess_page", { before_seq: seq[0], limit: 3 })).toEqual([]);
  });

  it("extends a page back to the turn it would cut", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-sql-store-turn-page-"));
    tempRoots.push(root);
    openSessionDb(join(root, "sessions.db"));
    upsertSession({
      id: "sess_turns",
      agent_id: "codex-acp",
      cwd: join(root, "sessions", "sess_turns"),
      acp_session_id: "acp_turns",
      title: "",
    });
    const prompt = (text: string) => {
      appendEvent("sess_turns", "user_prompt", { text });
      appendEvent("sess_turns", "openma_event", {
        type: "user.message",
        data: { input_kind: "prompt", text },
      });
    };
    const chunk = (text: string) =>
      appendEvent("sess_turns", "openma_event", { type: "agent.message_chunk", data: { text } });
    prompt("a");
    chunk("a1");
    prompt("b");
    for (let i = 0; i < 5; i++) chunk(`b${i}`);
    const seq = loadHistory("sess_turns").map((r) => r.seq);
    // The 3 newest rows sit inside turn "b"; the page starts at its
    // `user_prompt` row, not at its canonical envelope.
    const tail = loadHistoryPage("sess_turns", { limit: 3 });
    expect(tail.map((r) => r.seq)).toEqual(seq.slice(3));
    expect(tail[0]!.type).toBe("user_prompt");
    // The next page holds exactly turn "a".
    expect(
      loadHistoryPage("sess_turns", { before_seq: tail[0]!.seq, limit: 2 }).map((r) => r.seq),
    ).toEqual(seq.slice(0, 3));
  });

  it("keeps a row-bounded page inside a turn too long to align", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-sql-store-long-turn-"));
    tempRoots.push(root);
    openSessionDb(join(root, "sessions.db"));
    upsertSession({
      id: "sess_long",
      agent_id: "codex-acp",
      cwd: join(root, "sessions", "sess_long"),
      acp_session_id: "acp_long",
      title: "",
    });
    appendEvent("sess_long", "user_prompt", { text: "long" });
    for (let i = 0; i < 40; i++) {
      appendEvent("sess_long", "openma_event", { type: "agent.message_chunk", data: { text: `${i}` } });
    }
    const seq = loadHistory("sess_long").map((r) => r.seq);
    // 37 rows back to the opener exceed 3 extra pages of 4 rows.
    expect(loadHistoryPage("sess_long", { limit: 4 }).map((r) => r.seq)).toEqual(seq.slice(-4));
    // Within the budget the page still reaches the opener.
    expect(loadHistoryPage("sess_long", { before_seq: seq[14], limit: 4 }).map((r) => r.seq))
      .toEqual(seq.slice(0, 14));
  });
});

describe("sql-store event append hot path", () => {
  afterEach(() => {
    closeSessionDb();
  });

  async function openFresh(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    tempRoots.push(root);
    // Earlier suites in this file leave the module-level handle open.
    closeSessionDb();
    openSessionDb(join(root, "sessions.db"));
    upsertSession({
      id: "sess_hot",
      agent_id: "codex-acp",
      cwd: join(root, "sessions", "sess_hot"),
      acp_session_id: "acp_hot",
      title: "",
    });
    return root;
  }

  function canonical(eventId: string, seq?: number): Record<string, unknown> {
    return {
      schema_version: "oma.event.v1",
      event_id: eventId,
      type: "agent.message_chunk",
      session_id: "sess_hot",
      ...(seq === undefined ? {} : { seq }),
      data: { text: eventId },
    };
  }

  async function transcriptLines(root: string): Promise<Array<{ seq: number; data: unknown }>> {
    const created = getSession("sess_hot")!.created_at;
    const d = new Date(created);
    const path = join(
      root,
      "transcripts",
      String(d.getUTCFullYear()),
      String(d.getUTCMonth() + 1).padStart(2, "0"),
      String(d.getUTCDate()).padStart(2, "0"),
      "sess_hot.jsonl",
    );
    return (await readFile(path, "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
  }

  it("drops a duplicate canonical event without a SQL row or transcript line", async () => {
    const root = await openFresh("backchat-sql-store-dedupe-");
    appendEvent("sess_hot", "user_prompt", { text: "hi" });
    appendEvent("sess_hot", "openma_event", canonical("evt-1"));
    appendEvent("sess_hot", "openma_event", canonical("evt-1"));
    appendEvent("sess_hot", "openma_event", canonical("evt-2"));

    expect(loadHistory("sess_hot")).toHaveLength(3);
    const lines = await transcriptLines(root);
    // Transcript seq is the per-session ordinal; a dropped duplicate must not
    // consume one.
    expect(lines.map((line) => line.seq)).toEqual([1, 2, 3]);
    expect(eventIndexStatus()).toMatchObject({ dedupe: "unique", duplicates: 0 });
  });

  it("serves dedupe and sequence seed lookups from the event indexes", async () => {
    await openFresh("backchat-sql-store-plan-");
    const plans = explainEventQueryPlans();
    expect(plans.dedupe.join("\n")).toContain("USING INDEX events_openma_event_id_idx");
    expect(plans.sequence.join("\n")).toContain("USING INDEX events_openma_seq_idx");
  });

  it("seeds the canonical sequence from the true maximum, not the last row", async () => {
    await openFresh("backchat-sql-store-seq-");
    expect(latestOpenMAEventSequence("sess_hot")).toBe(0);
    appendEvent("sess_hot", "openma_event", canonical("a", 7));
    appendEvent("sess_hot", "openma_event", canonical("b", 41));
    appendEvent("sess_hot", "openma_event", canonical("c", 12));
    appendEvent("sess_hot", "openma_event", { schema: "oma.event.v1", event_id: "d", seq: 52 });
    appendEvent("sess_hot", "openma_event", canonical("e", -1));
    appendEvent("sess_hot", "openma_event", { event_id: "f", seq: 99 });
    appendEvent("sess_hot", "openma_event", canonical("g", 1.5));
    appendEvent("sess_hot", "user_prompt", { seq: 500 });
    expect(latestOpenMAEventSequence("sess_hot")).toBe(52);
  });

  it("falls back to a non-unique index when old rows already hold duplicates", async () => {
    const root = await openFresh("backchat-sql-store-fallback-");
    appendEvent("sess_hot", "openma_event", canonical("dup"));
    closeSessionDb();

    const raw = new DatabaseSync(join(root, "sessions.db"));
    raw.exec("DROP INDEX IF EXISTS events_openma_event_id_idx");
    raw.prepare(
      "INSERT INTO events (session_id, type, data, ts) VALUES (?, 'openma_event', ?, ?)",
    ).run("sess_hot", JSON.stringify(canonical("dup")), Date.now());
    raw.close();

    openSessionDb(join(root, "sessions.db"));
    expect(eventIndexStatus()).toMatchObject({ dedupe: "fallback", duplicates: 1 });
    // The migration never deletes evidence.
    expect(loadHistory("sess_hot")).toHaveLength(2);
    // Appends are still idempotent through the indexed pre-check.
    appendEvent("sess_hot", "openma_event", canonical("dup"));
    appendEvent("sess_hot", "openma_event", canonical("fresh"));
    expect(loadHistory("sess_hot")).toHaveLength(3);
    expect(explainEventQueryPlans().dedupe.join("\n"))
      .toContain("USING INDEX events_openma_event_id_idx");
  });
});
