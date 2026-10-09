import { mkdir } from "node:fs/promises";
import { test } from "./fixtures";
import { enableAgent, injectSession, launchApp } from "./helpers";

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
    await injectSession(page, { agentId: "codex-acp" });

    const sidebar = page.getByRole("complementary");
    const chatsHeader = sidebar.locator(".sidebar-section-header").filter({
      has: page.getByRole("button", { name: "对话", exact: true }),
    });
    await chatsHeader.hover();
    await page.waitForTimeout(300);

    await sidebar.screenshot({
      path: `${artifactDir}/sidebar-chats-section-header-hover-selected-zh.png`,
    });
  } finally {
    await cleanup();
  }
});
