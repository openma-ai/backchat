import { describe, expect, it } from "vitest";
import { OPENMA_SETTLE_ONLY_MESSAGE, isOpenmaSettleOnlyError, isOpenmaSettleOnlyRejection } from "@shared/openma";
import { restoreComposerText, subscribeComposerRestore } from "./composer-restore";

describe("CMA settle-only send rejection", () => {
  it("recognises the server 400 and the IPC-wrapped error", () => {
    expect(isOpenmaSettleOnlyRejection(400, "Session is waiting on you (stop_reason: requires_action); only settle events are accepted (user.tool_confirmation). Rejected: user.message")).toBe(true);
    expect(isOpenmaSettleOnlyRejection(400, "bad content")).toBe(false);
    expect(isOpenmaSettleOnlyRejection(500, "only settle events are accepted")).toBe(false);
    expect(isOpenmaSettleOnlyError(new Error(`Error invoking remote method 'openma:task-send': Error: ${OPENMA_SETTLE_ONLY_MESSAGE}`))).toBe(true);
    expect(isOpenmaSettleOnlyError(new Error("OpenMA request failed (400)."))).toBe(false);
  });

  it("puts the text back in the subscribed composer", () => {
    const got: string[] = [];
    const off = subscribeComposerRestore("s1", (text) => got.push(text));
    expect(restoreComposerText("s1", "hello")).toBe(true);
    expect(restoreComposerText("s2", "x")).toBe(false);
    off();
    expect(restoreComposerText("s1", "again")).toBe(false);
    expect(got).toEqual(["hello"]);
  });
});
