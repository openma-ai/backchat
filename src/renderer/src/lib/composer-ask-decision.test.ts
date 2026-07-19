import { describe, expect, it } from "vitest";
import { resolveAskDismissal } from "./composer-ask-decision";

describe("resolveAskDismissal", () => {
  it("prefers the first explicit reject option for permission asks", () => {
    expect(
      resolveAskDismissal({
        kind: "permission",
        ask: {
          options: [
            { optionId: "allow", kind: "allow_once" },
            { optionId: "reject-session", kind: "reject_once" },
            { optionId: "reject-always", kind: "reject_always" },
          ],
        },
      }),
    ).toEqual({ optionId: "reject-session" });
  });

  it("falls back safely when a permission ask has no reject option", () => {
    expect(
      resolveAskDismissal({
        kind: "permission",
        ask: {
          options: [{ optionId: "only-option", kind: "allow_once" }],
        },
      }),
    ).toEqual({ optionId: "only-option" });
    expect(
      resolveAskDismissal({
        kind: "permission",
        ask: { options: [] },
      }),
    ).toEqual({ optionId: null });
  });

  it("denies filesystem writes", () => {
    expect(resolveAskDismissal({ kind: "fsWrite" })).toEqual({
      optionId: null,
      approve: false,
    });
  });
});
