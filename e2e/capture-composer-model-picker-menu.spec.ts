import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession, launchApp } from "./helpers";

const artifactDir = "/opt/cursor/artifacts/screenshots";

function groupedModelOptions(count: number) {
  const providers = ["anthropic-proxy", "openai-codex", "devin"];
  return providers.map((provider) => ({
    group: provider,
    name: provider,
    options: Array.from({ length: Math.ceil(count / providers.length) }, (_, index) => ({
      value: `${provider}-${index}`,
      name: `${provider} model ${index}`,
    })),
  }));
}

test("composer model picker stays within viewport with search", async () => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  const { page, cleanup } = await launchApp({
    language: "zh-CN",
    env: { BACKCHAT_E2E_VISIBLE: "1" },
  });
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await enableAgent(page, "codex-acp");
    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "model-picker-menu",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "openai-codex-2",
            options: groupedModelOptions(24),
          },
        ],
      },
    });

    const runPicker = page.getByRole("button", { name: /Run on|运行位置/ }).first();
    await runPicker.click();
    const modelSubmenu = page.getByRole("menuitem", { name: /模型|Model/ });
    await modelSubmenu.hover();

    const search = page.getByRole("searchbox");
    await expect(search).toBeVisible();
    await search.fill("devin 1");

    const listbox = page.getByRole("listbox", { name: "Options" });
    await expect(listbox).toBeVisible();
    await expect(page.getByText("devin model 1")).toBeVisible();
    await expect(page.getByText("openai-codex model 1")).toHaveCount(0);

    const panel = page.locator('[data-slot="dropdown-menu-sub-content"]').last();
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(420 + 2);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);

    await page.screenshot({
      path: `${artifactDir}/composer-model-picker-menu-zh.png`,
      fullPage: false,
    });
  } finally {
    await cleanup();
  }
});
