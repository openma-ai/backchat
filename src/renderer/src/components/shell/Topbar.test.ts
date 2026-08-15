import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Topbar.tsx", import.meta.url), "utf8");
const singleChatTopbar = source.slice(0, source.indexOf("export function PairTopbar"));

describe("single-chat topbar contract", () => {
  it("keeps task-level runtime updates in top chrome, never in the composer", () => {
    expect(singleChatTopbar).toContain(
      '{active.label || t("sidebar.newChat")}',
    );
    expect(singleChatTopbar).toContain(
      "<SessionRuntimeUpdateControl",
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
    expect(singleChatTopbar).toContain("requestArchive(");
    expect(singleChatTopbar).not.toContain("sessionStore.newSideDraft");
    expect(singleChatTopbar).not.toContain('t("topbar.openSideChat")');
    expect(singleChatTopbar).toContain("window.backchat.sessionClose");
    expect(singleChatTopbar).toContain("active.supportsSessionClose");
    expect(singleChatTopbar).toContain('t("sidebar.rename")');
    expect(singleChatTopbar).not.toContain("TBD");
  });
});
