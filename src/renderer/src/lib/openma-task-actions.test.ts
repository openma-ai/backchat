import { afterEach, expect, it, vi } from "vitest";
import { useChatSessionActions } from "./chat-session-actions";
import type { SessionRow } from "./session-types";
import { resolveAskDismissal } from "./composer-ask-decision";

afterEach(() => vi.unstubAllGlobals());

it("dismissing a runner permission cancels instead of choosing an allow option", () => {
  expect(resolveAskDismissal({ kind: "permission", openmaResponse: "runtime_permission", ask: {
    options: [{ optionId: "only-allow", kind: "allow_once" }],
  } })).toEqual({ optionId: null });
});

it.each(["write:once", null])("replies to a runner permission with the original callback outcome (%s)", async (optionId) => {
  const delivered: unknown[][] = [];
  vi.stubGlobal("window", { backchat: { openmaTaskRespond: async (...args: unknown[]) => { delivered.push(args); } } });
  const active = { id: "remote-task", openma: {}, pendingAsks: [{ kind: "permission", openmaResponse: "runtime_permission", ask: {
    requestId: "request", options: [{ optionId: "write:once", name: "Write once", kind: "allow_once" }],
  } }] } as unknown as SessionRow;
  const actions = useChatSessionActions({ active, isNativeSubagent: false, isSide: false });
  await actions.resolveAsk("invented");
  expect(delivered).toEqual([]);
  await actions.resolveAsk(optionId);
  expect(delivered).toEqual([["remote-task", "request", { type: "custom_result", text: JSON.stringify({ outcome: optionId === null ? { outcome: "cancelled" } : { outcome: "selected", optionId } }) }]]);
});
