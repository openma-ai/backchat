import { mkdir } from "node:fs/promises";
import { test } from "./fixtures";
import { launchApp } from "./helpers";

const artifactDir = "/opt/cursor/artifacts/screenshots";

test("capture renderer crash page before and after", async () => {
  test.setTimeout(180_000);
  await mkdir(artifactDir, { recursive: true });

  const capture = async (
    filename: string,
    env: Record<string, string>,
    language?: "en" | "zh-CN",
  ) => {
    const { app, page, cleanup } = await launchApp({
      language,
      skipRendererReady: true,
      env: {
        BACKCHAT_DEMO_RENDERER_CRASH: "1",
        BACKCHAT_E2E_VISIBLE: "1",
        ...env,
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
      await page.waitForSelector('[data-renderer-error-fallback="true"]', {
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

  await capture("renderer-crash-fallback-before.png", {
    BACKCHAT_DEMO_RENDERER_CRASH_VARIANT: "legacy",
  });
  await capture("renderer-crash-fallback-after-en.png", {});
  await capture("renderer-crash-fallback-after-zh.png", {}, "zh-CN");
});
