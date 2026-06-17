import { describe, expect, it } from "vitest";
import { findOpenmaPetDeepLink, parseOpenmaPetDeepLink } from "./pet-deep-link";

describe("parseOpenmaPetDeepLink", () => {
  it("parses harness event links", () => {
    expect(
      parseOpenmaPetDeepLink(
        "openma-pet://event/backchat/session.completed?sessionId=sess-1&turnId=turn-1&label=Done",
      ),
    ).toEqual({
      harness: "backchat",
      event: "session.completed",
      sessionId: "sess-1",
      turnId: "turn-1",
      label: "Done",
    });

    expect(
      parseOpenmaPetDeepLink(
        "openma-pet://event/codex/approval.requested?threadId=thread-1&label=Approve%20run",
      ),
    ).toEqual({
      harness: "codex",
      event: "approval.requested",
      threadId: "thread-1",
      label: "Approve run",
    });
  });

  it("rejects incomplete or unrelated links", () => {
    expect(parseOpenmaPetDeepLink("backchat://sessions/sess-1")).toBeNull();
    expect(parseOpenmaPetDeepLink("openma-pet://event/backchat")).toBeNull();
    expect(parseOpenmaPetDeepLink("openma-pet://settings")).toBeNull();
  });
});

describe("findOpenmaPetDeepLink", () => {
  it("finds the first pet deep link in argv", () => {
    expect(
      findOpenmaPetDeepLink([
        "Electron",
        "--flag",
        "openma-pet://event/backchat/session.failed?sessionId=sess-1&label=Build%20failed",
      ]),
    ).toEqual({
      harness: "backchat",
      event: "session.failed",
      sessionId: "sess-1",
      label: "Build failed",
    });
  });
});
