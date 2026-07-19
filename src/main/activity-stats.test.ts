import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { enrichActivityStats, queryActivityStats } from "./activity-stats";

const openDatabases: DatabaseSync[] = [];

afterEach(() => {
  for (const db of openDatabases) db.close();
  openDatabases.length = 0;
});

function fixtureDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  openDatabases.push(db);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      last_used_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      archived_at INTEGER,
      pair_id TEXT
    );
    CREATE TABLE events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      ts INTEGER NOT NULL
    );
  `);
  return db;
}

function utc(day: number, hour = 12): number {
  return Date.UTC(2026, 6, day, hour);
}

describe("queryActivityStats", () => {
  it("aggregates lifetime activity and harness business metrics without double-counting pair tasks", () => {
    const db = fixtureDb();
    const insertSession = db.prepare(`
      INSERT INTO sessions (id, agent_id, created_at, last_used_at, archived_at, pair_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertSession.run("solo-codex", "codex-acp", utc(12), utc(14), null, null);
    insertSession.run("pair-claude", "claude-acp", utc(13), utc(15), null, "pair-one");
    insertSession.run("pair-codex", "codex-acp", utc(13), utc(15), utc(16), "pair-one");

    const insertEvent = db.prepare(
      `INSERT INTO events (session_id, type, ts) VALUES (?, ?, ?)`,
    );
    insertEvent.run("solo-codex", "user_prompt", utc(12));
    insertEvent.run("solo-codex", "user_prompt", utc(14));
    insertEvent.run("solo-codex", "tool_call", utc(14, 13));
    insertEvent.run("solo-codex", "tool_call_update", utc(14, 14));
    insertEvent.run("pair-claude", "user_prompt", utc(13));
    insertEvent.run("pair-claude", "tool_call", utc(13, 13));
    insertEvent.run("pair-claude", "user_prompt", utc(15));
    insertEvent.run("pair-codex", "user_prompt", utc(13, 14));
    insertEvent.run("pair-codex", "agent_message_chunk", utc(13, 15));

    const stats = queryActivityStats(db, { now: utc(15, 18), days: 7 });

    expect(stats.summary).toEqual({
      total_tasks: 2,
      total_runs: 3,
      total_turns: 5,
      total_tool_calls: 2,
      total_harnesses: 2,
      active_days: 4,
      current_streak_days: 4,
      longest_streak_days: 4,
    });
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.slice(-4)).toEqual([
      { date: "2026-07-12", tasks: 1, turns: 1, tool_calls: 0 },
      { date: "2026-07-13", tasks: 1, turns: 2, tool_calls: 1 },
      { date: "2026-07-14", tasks: 0, turns: 1, tool_calls: 1 },
      { date: "2026-07-15", tasks: 0, turns: 1, tool_calls: 0 },
    ]);
    expect(stats.harnesses).toEqual([
      {
        harness_id: "codex-acp",
        tasks: 2,
        runs: 2,
        turns: 3,
        tool_calls: 1,
        active_days: 3,
        last_active_at: utc(14, 13),
      },
      {
        harness_id: "claude-acp",
        tasks: 1,
        runs: 1,
        turns: 2,
        tool_calls: 1,
        active_days: 2,
        last_active_at: utc(15),
      },
    ]);
  });

  it("returns a complete zero-filled activity window for an empty store", () => {
    const stats = queryActivityStats(fixtureDb(), { now: utc(15), days: 3 });

    expect(stats.summary).toEqual({
      total_tasks: 0,
      total_runs: 0,
      total_turns: 0,
      total_tool_calls: 0,
      total_harnesses: 0,
      active_days: 0,
      current_streak_days: 0,
      longest_streak_days: 0,
    });
    expect(stats.daily).toEqual([
      { date: "2026-07-13", tasks: 0, turns: 0, tool_calls: 0 },
      { date: "2026-07-14", tasks: 0, turns: 0, tool_calls: 0 },
      { date: "2026-07-15", tasks: 0, turns: 0, tool_calls: 0 },
    ]);
    expect(stats.harnesses).toEqual([]);
  });
});

describe("enrichActivityStats", () => {
  it("attaches registry labels and icon URLs to matching harness rows", () => {
    const stats = queryActivityStats(fixtureDb(), { now: utc(15), days: 1 });
    stats.harnesses = [{
      harness_id: "codex-acp",
      tasks: 1,
      runs: 1,
      turns: 2,
      tool_calls: 3,
      active_days: 1,
      last_active_at: utc(15),
    }];

    expect(enrichActivityStats(stats, [{
      id: "codex-acp",
      label: "Codex",
      icon: "https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg",
    }]).harnesses[0]).toMatchObject({
      harness_label: "Codex",
      icon_url: "https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg",
    });
  });
});
