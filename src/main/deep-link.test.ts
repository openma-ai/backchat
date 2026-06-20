import { describe, expect, it } from "vitest";
import { findBackchatDeepLink, parseBackchatDeepLink } from "./deep-link.js";

describe("parseBackchatDeepLink", () => {
  it("parses session links", () => {
    expect(parseBackchatDeepLink("backchat://sessions/sess-123")).toEqual({
      kind: "session",
      id: "sess-123",
      path: "/chat/sess-123",
    });
  });

  it("parses pair links", () => {
    expect(parseBackchatDeepLink("backchat://pairs/pair-abc")).toEqual({
      kind: "pair",
      id: "pair-abc",
      path: "/pair/pair-abc",
    });
  });

  it("accepts singular aliases and decodes ids", () => {
    expect(parseBackchatDeepLink("backchat://session/sess-%E4%B8%80")).toEqual({
      kind: "session",
      id: "sess-一",
      path: "/chat/sess-%E4%B8%80",
    });
    expect(parseBackchatDeepLink("backchat://pair/pair-one")).toEqual({
      kind: "pair",
      id: "pair-one",
      path: "/pair/pair-one",
    });
  });

  it("rejects non-backchat and incomplete links", () => {
    expect(parseBackchatDeepLink("codex://threads/abc")).toBeNull();
    expect(parseBackchatDeepLink("backchat://sessions")).toBeNull();
    expect(parseBackchatDeepLink("backchat://settings")).toBeNull();
    expect(parseBackchatDeepLink("backchat://sessions/%E0%A4%A")).toBeNull();
  });
});

describe("findBackchatDeepLink", () => {
  it("finds the first deep link in process argv", () => {
    expect(
      findBackchatDeepLink([
        "/Applications/Backchat.app/Contents/MacOS/Backchat",
        "--flag",
        "backchat://pairs/pair-abc",
      ]),
    ).toEqual({
      kind: "pair",
      id: "pair-abc",
      path: "/pair/pair-abc",
    });
  });
});
