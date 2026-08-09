import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("NewChatPage route boundary", () => {
  it("keeps the cold-create page separate from the transcript page", () => {
    const router = readFileSync(resolve(__dirname, "../router.tsx"), "utf8");
    const page = readFileSync(resolve(__dirname, "NewChatPage.tsx"), "utf8");
    const chatPage = readFileSync(resolve(__dirname, "ChatPage.tsx"), "utf8");
    const styles = readFileSync(resolve(__dirname, "../styles/index.css"), "utf8");

    expect(router).toContain('import { NewChatPage } from "@/pages/NewChatPage"');
    expect(router).toContain("component: NewChatPage");
    expect(page).toContain('data-page="new-chat"');
    expect(page).toContain("<EmptyStateIntro");
    expect(page).toContain("<Composer");
    expect(page).not.toContain("<Conversation");
    expect(chatPage).toContain("return <ChatView />");
    expect(styles).toContain(".new-chat-page .home-suggestion-container");
    expect(styles).toMatch(
      /\.new-chat-page \.home-suggestion-container[\s\S]*?max-width: min\(100%, var\(--home-composer-width\)\);/,
    );
    expect(styles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(styles).toContain("@container (max-width: 960px)");
    expect(styles).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(styles).toContain(".home-suggestion-card:nth-child(n + 4)");
    expect(styles).toContain("@container (max-width: 640px)");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(styles).toContain(".home-suggestion-card:nth-child(n + 3)");
  });

  it("places compact runtime and project controls below the composer", () => {
    const page = readFileSync(resolve(__dirname, "NewChatPage.tsx"), "utf8");
    const controls = readFileSync(
      resolve(__dirname, "../components/chat/ComposerProjectControls.tsx"),
      "utf8",
    );
    const composerIndex = page.indexOf("<Composer");
    const footerIndex = page.indexOf("<ProjectChipRow");

    expect(footerIndex).toBeGreaterThan(composerIndex);
    expect(controls).toContain('style={{ height: "var(--row-h)" }}');
    expect(controls).toContain('import { Button } from "@/components/ui/button"');
    expect(controls).toContain("<RuntimeLocationControl />");
    expect(controls.match(/<PopoverTrigger asChild>/g)).toHaveLength(1);
    expect(controls.match(/<Button[\s\S]*?variant="ghost"[\s\S]*?size="sm"/g)).toHaveLength(1);
    expect(controls).not.toContain("focus:bg-bg-surface");
    expect(controls).toContain("composer-control-row-inset");

    const composer = readFileSync(
      resolve(__dirname, "../components/chat/Composer.tsx"),
      "utf8",
    );
    expect(composer).toContain("composer-control-row-inset");
  });

  it("keeps suggestion cards and the resting composer at the same larger height", () => {
    const styles = readFileSync(resolve(__dirname, "../styles/index.css"), "utf8");

    expect(styles).toContain("--composer-resting-height: 104px;");
    expect(styles).toMatch(
      /\.composer-card \{[\s\S]*?min-height: var\(--composer-resting-height\);/,
    );
    expect(styles).toMatch(
      /\.new-chat-page \.home-suggestion-card \{[\s\S]*?min-height: max\(var\(--composer-resting-height\), var\(--home-suggestion-card-height, 0px\)\);/,
    );
  });
});
