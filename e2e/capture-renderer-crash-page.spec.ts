import { mkdir } from "node:fs/promises";
import { test } from "./fixtures";
import { launchApp } from "./helpers";

const artifactDir = "/opt/cursor/artifacts/screenshots";

test("capture renderer crash page (en + zh)", async () => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  const capture = async (
    filename: string,
    language?: "en" | "zh-CN",
  ) => {
    const { app, page, cleanup } = await launchApp({
      language,
      skipRendererReady: true,
      env: {
        BACKCHAT_DEMO_RENDERER_CRASH: "1",
        BACKCHAT_E2E_VISIBLE: "1",
      },
    });
    try {
      if (language === "zh-CN") {
        await page.evaluate(async () => {
          const current = await window.backchat.settingsGet();
          await window.backchat.settingsPatch({
            appearance: { ...current.appearance, language: "zh-CN" },
          });
        });
        await page.reload({ waitUntil: "domcontentloaded" });
      }
      await page.waitForSelector('[data-backchat-crash-mark="true"]', {
        timeout: 30_000,
      });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${artifactDir}/${filename}`,
        fullPage: true,
      });
    } finally {
      await cleanup();
    }
  };

  await capture("renderer-crash-fallback-after-en.png");
  await capture("renderer-crash-fallback-after-zh.png", "zh-CN");
});
