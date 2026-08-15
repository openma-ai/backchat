import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ArchiveScheduledChatDialog.tsx", import.meta.url), "utf8");

describe("ArchiveScheduledChatDialog", () => {
  it("matches the destructive archive-and-remove confirmation", () => {
    expect(source).toContain("scheduled.archiveTitle");
    expect(source).toContain("scheduled.archiveBody");
    expect(source).toContain("scheduled.archiveHint");
    expect(source).toContain('t("scheduled.archiveConfirm")');
    expect(source).toContain('variant="destructive"');
    expect(source).toContain("<strong>");
  });
});
