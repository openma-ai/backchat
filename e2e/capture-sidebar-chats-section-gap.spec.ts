import { mkdir } from "node:fs/promises";
import { test } from "./fixtures";
import { enableAgent, launchApp, persistSessionFixture } from "./helpers";

const artifactDir = "/opt/cursor/artifacts/screenshots";

test("capture sidebar chats section header hover with selected first row", async () => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  const { page, cleanup } = await launchApp({
    language: "zh-CN",
    env: { BACKCHAT_E2E_VISIBLE: "1" },
  });
  try {
    await enableAgent(page, "codex-acp");
    await persistSessionFixture(page, {
      sessionId: "sidebar-gap-demo",
      title: "间距验收对话",
      agentId: "codex-acp",
      cwd: "",
      acpSessionId: "acp-sidebar-gap-demo",
      events: [],
    });
    await page.reload();
    await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });

    const sidebar = page.getByRole("complementary");
    const chatsHeader = sidebar.locator(
      "section.sidebar-section > .sidebar-section-header",
    ).filter({
      has: page.getByRole("button", { name: "对话", exact: true }),
    });
    const chatsSection = chatsHeader.locator("xpath=ancestor::section[1]");
    await page.getByRole("button", { name: "间距验收对话", exact: true }).click();
    await chatsHeader.hover();
    await page.waitForTimeout(300);

    await chatsSection.screenshot({
      path: `${artifactDir}/sidebar-chats-section-header-hover-selected-zh.png`,
    });
  } finally {
    await cleanup();
  }
});
