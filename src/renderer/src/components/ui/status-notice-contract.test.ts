import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentSource = (relativePath: string) =>
  readFileSync(resolve(__dirname, relativePath), "utf8");

describe("shared status notice contract", () => {
  it("centralizes contextual warning and error presentation", () => {
    const consumers = [
      "../chat/ComposerNotice.tsx",
      "../chat/ChatTurn.tsx",
      "../chat/McpAppView.tsx",
      "../chat/InlineVisualizationView.tsx",
      "../../pages/settings/Agents.tsx",
      "../../pages/settings/Archive.tsx",
    ];

    for (const path of consumers) {
      expect(componentSource(path), path).toContain(
        "@/components/ui/status-notice",
      );
    }
  });

  it("keeps session errors in the composer notice lane", () => {
    const chatView = componentSource("../chat/ChatView.tsx");

    expect(chatView).toContain("<StatusNotice");
    expect(chatView).not.toContain(
      '<div className="bg-danger-subtle px-4 py-2 text-xs text-danger">',
    );
  });
});
