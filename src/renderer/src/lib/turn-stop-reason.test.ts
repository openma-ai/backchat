import { describe, expect, test } from "vitest";

import { turnStopNotice } from "./turn-stop-reason";

describe("turnStopNotice", () => {
  test("says so when the agent stopped at a limit or declined", () => {
    // These reach the client as an ordinary completion, so without the agent's
    // stated reason a cut-off answer reads as a finished one.
    expect(turnStopNotice({ status: "complete", stopReason: "max_tokens" }))
      .toEqual({ key: "chat.stopMaxTokens", tone: "truncated" });
    expect(
      turnStopNotice({ status: "complete", stopReason: "max_turn_requests" }),
    ).toEqual({ key: "chat.stopMaxTurnRequests", tone: "truncated" });
    expect(turnStopNotice({ status: "complete", stopReason: "refusal" }))
      .toEqual({ key: "chat.stopRefusal", tone: "refused" });
  });

  test("stays quiet when the agent ended the turn itself", () => {
    expect(turnStopNotice({ status: "complete", stopReason: "end_turn" }))
      .toBeNull();
  });

  test("stays quiet when no reason was reported", () => {
    // Older transports report a bare completion boundary. Inventing a notice
    // for silence would be worse than saying nothing.
    expect(turnStopNotice({ status: "complete" })).toBeNull();
  });

  test("leaves cancellation to the status that already carries it", () => {
    expect(turnStopNotice({ status: "cancelled", stopReason: "cancelled" }))
      .toBeNull();
    expect(turnStopNotice({ status: "running", stopReason: "max_tokens" }))
      .toBeNull();
  });
});
