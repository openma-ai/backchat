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
});
