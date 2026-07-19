import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("workspace ownership contract", () => {
  it("never treats the deprecated settings workspace as runtime state", () => {
    for (const source of [
      read("../components/chat/ChatView.tsx"),
      read("../components/shell/SideChatPanel.tsx"),
      read("./chat-submission.ts"),
      read("./chat-session-actions.ts"),
    ]) {
      expect(source).not.toContain("default.workspace_path");
      expect(source).not.toContain("defaultWorkspacePath");
    }
  });
});
