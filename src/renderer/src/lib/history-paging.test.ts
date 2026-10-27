import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pending: false,
  window: { oldestSeq: 1000, hasMore: true, loading: false },
  turns: [] as Array<{ id: string }>,
  calls: [] as Array<{ before_seq?: number; limit?: number }>,
}));

vi.mock("./session-store", () => ({
  sessionStore: {
    get: () => undefined,
    setHistoryPending: (value: string, pending: boolean) => { state.pending = pending; },
    isHistoryPending: () => state.pending,
    historyWindowFor: () => state.window,
    setHistoryLoading: (_id: string, loading: boolean) => { state.window.loading = loading; },
    turnsFor: () => state.turns,
    replayHistoryWindow: (_id: string, rows: Array<{ seq: number }>, opts: { hasMore: boolean }) => {
      state.window.oldestSeq = rows[0]?.seq ?? state.window.oldestSeq;
      state.window.hasMore = opts.hasMore;
      state.turns = rows.some((row) => row.seq === 1) ? [{ id: "first" }, { id: "second" }] : [{ id: "last" }];
    },
    prependHistory: (_id: string, rows: Array<{ seq: number }>, opts: { hasMore: boolean }) => {
      state.window.oldestSeq = rows[0]?.seq ?? state.window.oldestSeq;
      state.window.hasMore = opts.hasMore;
      state.window.loading = false;
      if (rows.length) state.turns = [{ id: "older" }, ...state.turns];
    },
  },
}));

import { loadOlderHistory, openHistoryWindow } from "./history-paging";

beforeEach(() => {
  state.pending = false;
  state.window = { oldestSeq: 1000, hasMore: true, loading: false };
  state.turns = [];
  state.calls = [];
});

describe("history paging", () => {
  it("opens enough event rows to expose earlier turns instead of only a streaming tail", async () => {
    vi.stubGlobal("window", { backchat: {
      sessionsLoadHistory: vi.fn(async (_id: string, options: { limit: number }) => {
        state.calls.push(options);
        return options.limit >= 1600
          ? [{ seq: 1 }, { seq: 1000 }]
          : [{ seq: 1000 }];
      }),
    } });
    await openHistoryWindow("s");
    expect(state.turns).toHaveLength(2);
    expect(state.pending).toBe(false);
    vi.unstubAllGlobals();
  });

  it("captures the latest reading position after fetching but before publishing older rows", async () => {
    let resolveRows!: (rows: Array<{seq: number}>) => void;
    vi.stubGlobal("window", {backchat: {sessionsLoadHistory: () => new Promise<Array<{seq:number}>>(resolve => {resolveRows = resolve;})}});
    let currentPosition = 10;
    let capturedPosition: number | undefined;
    const pending = loadOlderHistory("s", () => {
      capturedPosition = currentPosition;
      expect(state.turns).toEqual([]);
    });
    currentPosition = 90;
    expect(capturedPosition).toBeUndefined();
    resolveRows([{seq: 500}]);
    await pending;
    expect(capturedPosition).toBe(90);
    expect(state.turns).toEqual([{id: "older"}]);
    vi.unstubAllGlobals();
  });

  it("fetches a larger preceding window in one request while preserving the previous boundary", async () => {
    vi.stubGlobal("window", { backchat: {
      sessionsLoadHistory: vi.fn(async (_id: string, options: { before_seq: number; limit: number }) => {
        state.calls.push(options);
        return [{ seq: 500 }];
      }),
    } });
    await loadOlderHistory("s");
    expect(state.calls).toEqual([{ before_seq: 1000, limit: 1600 }]);
    expect(state.window.oldestSeq).toBe(500);
    vi.unstubAllGlobals();
  });
});
