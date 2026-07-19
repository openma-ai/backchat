import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Topbar.tsx", import.meta.url), "utf8");
const singleChatTopbar = source.slice(0, source.indexOf("export function PairTopbar"));

describe("single-chat topbar contract", () => {
  it("shows only the task title and one actions select button", () => {
    expect(singleChatTopbar).toContain(
      '{active.label || t("sidebar.newChat")}',
    );
    expect(singleChatTopbar).toContain("MoreHorizontalIcon");
    expect(singleChatTopbar).toContain("<DropdownMenu");

    expect(singleChatTopbar).not.toContain("<FolderIcon");
    expect(singleChatTopbar).not.toContain("<CwdChip");
    expect(singleChatTopbar).not.toContain("<RuntimeChip");
    expect(singleChatTopbar).not.toContain("<ModeChip");
    expect(singleChatTopbar).not.toContain("<ContextUsageChip");
  });

  it("keeps the select menu limited to working task actions", () => {
    expect(singleChatTopbar).toContain("sessionStore.pin(active.id)");
    expect(singleChatTopbar).toContain("sessionStore.archive(active.id)");
    expect(singleChatTopbar).toContain("sessionStore.newSideDraft");
    expect(singleChatTopbar).not.toContain("Rename");
    expect(singleChatTopbar).not.toContain("TBD");
  });
});
