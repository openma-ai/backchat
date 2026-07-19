import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PairChatView.tsx", import.meta.url), "utf8");

describe("pair chat startup latency", () => {
  it("does not wait for a duplicate ready event after start IPC completes", () => {
    expect(source).toContain("await window.backchat.sessionStart({");
    expect(source).not.toContain("waitForReady(");
    expect(source).not.toContain('resolve("timeout")');
  });
});
