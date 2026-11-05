import { expect, test } from "vitest";
import { SessionTurnMap } from "./session-turn-map";
import type { Turn } from "./session-types";

const turn = (id: string, sessionId: string): Turn => ({ id, sessionId, promptText: id, events: [], assistantText: "", thoughtText: "", status: "complete", startedAt: 0 });
const assertMatchesScan = (map: SessionTurnMap, sessions: string[]) => {
  for (const sessionId of sessions) {
    const expected = [...map.values()].filter(t => t.sessionId === sessionId);
    const indexed = [...map.valuesForSession(sessionId)];
    expect(indexed).toEqual(expected);
    indexed.forEach((value, i) => expect(value).toBe(expected[i]));
  }
};

test("session reads match global registration order through replacement, rehome and prepend", () => {
  const map = new SessionTurnMap();
  map.set("a", turn("a", "one"));
  map.set("b", turn("b", "two"));
  map.set("c", turn("c", "one"));
  map.set("d", turn("d", "two"));
  map.set("a", { ...map.get("a")!, assistantText: "replaced" });
  assertMatchesScan(map, ["one", "two", "missing"]);
  map.set("a", { ...map.get("a")!, sessionId: "two" });
  map.set("d", { ...map.get("d")!, sessionId: "one" });
  assertMatchesScan(map, ["one", "two"]);
  const newer = [...map.valuesForSession("one")];
  for (const t of newer) map.delete(t.id);
  map.set("older", turn("older", "one"));
  for (const t of newer) map.set(t.id, t);
  assertMatchesScan(map, ["one", "two"]);
  expect([...map.valuesForSession("one")].map(t => t.id)).toEqual(["older", "c", "d"]);
});

test("stream mutations share identity; deleted and cleared sessions release their turns", () => {
  const map = new SessionTurnMap();
  const live = turn("live", "one");
  map.set(live.id, live);
  live.assistantText += "streamed";
  expect([...map.valuesForSession("one")][0]).toBe(live);
  expect(map.delete("missing")).toBe(false);
  expect(map.delete("live")).toBe(true);
  expect([...map.valuesForSession("one")]).toEqual([]);
  map.set("new", turn("new", "one"));
  assertMatchesScan(map, ["one"]);
  map.clear();
  expect(map.size).toBe(0);
  expect([...map.valuesForSession("one")]).toEqual([]);
});

test("index stays equivalent through deterministic mixed-session churn", () => {
  const map = new SessionTurnMap();
  const sessions = Array.from({ length: 20 }, (_, i) => `s${i}`);
  for (let i = 0; i < 1000; i++) {
    const id = `t${(i * 17) % 101}`;
    if (i % 7 === 0) map.delete(id);
    else map.set(id, turn(id, sessions[i % sessions.length]!));
    if (i % 29 === 0) assertMatchesScan(map, sessions);
  }
  assertMatchesScan(map, sessions);
});

test("arrayForSession stays stable until a write touches that session", () => {
  const map = new SessionTurnMap();
  map.set("a", turn("a", "one"));
  map.set("b", turn("b", "two"));
  const one = map.arrayForSession("one");
  expect(map.arrayForSession("one")).toBe(one);
  map.set("c", turn("c", "two"));
  expect(map.arrayForSession("one")).toBe(one);
  map.set("d", turn("d", "one"));
  expect(map.arrayForSession("one")).not.toBe(one);
  expect([...map.arrayForSession("one")].map(t => t.id)).toEqual(["a", "d"]);
});

test("cached arrays invalidate only the written sessions and retain live stream references", () => {
  const map = new SessionTurnMap();
  map.set("a", turn("a", "one"));
  map.set("b", turn("b", "two"));
  const one = map.arrayForSession("one");
  const two = map.arrayForSession("two");
  map.get("a")!.assistantText += "live";
  expect(map.arrayForSession("one")).toBe(one);
  expect(one[0]!.assistantText).toBe("live");
  map.set("b", { ...map.get("b")!, assistantText: "replacement" });
  expect(map.arrayForSession("one")).toBe(one);
  expect(map.arrayForSession("two")).not.toBe(two);
  map.set("a", { ...map.get("a")!, sessionId: "two" });
  expect(map.arrayForSession("one")).toEqual([]);
  expect(map.arrayForSession("two").map(t => t.id)).toEqual(["a", "b"]);
  map.delete("b");
  expect(map.arrayForSession("two").map(t => t.id)).toEqual(["a"]);
  map.clear();
  expect(map.arrayForSession("two")).toEqual([]);
  expect(map.arrayForSession("one")).toBe(map.arrayForSession("missing"));
});
