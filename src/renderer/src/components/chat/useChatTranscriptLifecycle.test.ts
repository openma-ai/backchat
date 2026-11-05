import { afterEach, describe, expect, it } from "vitest";
import {
  resetPaintedSessionIdsForTests,
  shouldHoldFirstScreen,
} from "./useChatTranscriptLifecycle";

afterEach(() => {
  resetPaintedSessionIdsForTests();
});

describe("shouldHoldFirstScreen", () => {
  it("does not hold when the session already has in-memory turns (first send)", () => {
    expect(
      shouldHoldFirstScreen({
        persistedSessionId: "sess-new",
        historyPending: true,
        hasTranscriptContent: true,
        alreadyPainted: false,
        paintedSessionId: null,
      }),
    ).toBe(false);
  });

  it("does not hold for already-painted sessions even while history is pending", () => {
    expect(
      shouldHoldFirstScreen({
        persistedSessionId: "sess-old",
        historyPending: true,
        hasTranscriptContent: false,
        alreadyPainted: true,
        paintedSessionId: null,
      }),
    ).toBe(false);
  });

  it("holds for an empty cold open while history is pending", () => {
    expect(
      shouldHoldFirstScreen({
        persistedSessionId: "sess-cold",
        historyPending: true,
        hasTranscriptContent: false,
        alreadyPainted: false,
        paintedSessionId: null,
      }),
    ).toBe(true);
  });

  it("holds until the empty first paint settles", () => {
    expect(
      shouldHoldFirstScreen({
        persistedSessionId: "sess-cold",
        historyPending: false,
        hasTranscriptContent: false,
        alreadyPainted: false,
        paintedSessionId: null,
      }),
    ).toBe(true);
    expect(
      shouldHoldFirstScreen({
        persistedSessionId: "sess-cold",
        historyPending: false,
        hasTranscriptContent: false,
        alreadyPainted: false,
        paintedSessionId: "sess-cold",
      }),
    ).toBe(false);
  });
});
