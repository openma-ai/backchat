import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launchApp } from "./helpers";

const artifactDir = join(process.cwd(), "artifacts/theme-system");

test("captures the v1 default and image-led theme presentations", async () => {
  const { page, cleanup } = await launchApp();
  try {
    await mkdir(artifactDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 810 });

    const apply = async (themeId: string, language: "en" | "zh-CN") => {
      await page.evaluate(async ({ themeId, language }) => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          default: { ...current.default, agent_id: "codex-acp" },
          appearance: {
            ...current.appearance,
            theme: "light",
            language,
            light_theme_id: themeId,
          },
        });
      }, { themeId, language });
      await expect(page.locator("html")).toHaveAttribute("data-theme", themeId);
      await expect(page.locator('[data-slot="home-suggestions"]')).toBeVisible();
      await page.waitForTimeout(500);
    };

    await apply("backchat-light", "en");
    await page.screenshot({
      path: join(artifactDir, "default-spec-v1.png"),
      animations: "disabled",
    });

    await apply("rose-garden-light", "zh-CN");
    await page.screenshot({
      path: join(artifactDir, "rose-garden-spec-v1.png"),
      animations: "disabled",
    });

    await apply("red-horizon-light", "zh-CN");
    const redHero = page.locator(".home-hero-panel");
    await expect(redHero).toHaveAttribute("data-home-hero-surface", "flush");
    await expect(redHero).toHaveAttribute("data-home-hero-width", "bleed");
    await expect(redHero).toHaveCSS("border-top-width", "0px");
    await expect(redHero).toHaveCSS("border-top-left-radius", "0px");
    await expect(redHero).toHaveCSS("min-height", "384px");
    const redTitle = page.getByRole("heading", { name: "OpenAI 是人民的 AI。" });
    await expect(redTitle).toBeVisible();
    await expect(redTitle).toHaveCSS("font-size", "48px");
    await expect(redTitle).toHaveCSS("font-weight", "700");
    await expect(page.getByText("用先进的工具，为每一个人创造更多可能。")).toBeVisible();
    await expect(page.getByText("编写代码与应用")).toBeVisible();
    await expect(page.getByText("数据分析与洞察")).toBeVisible();
    await expect(page.getByText("智能体与工作流")).toBeVisible();
    await expect(page.getByText("修复问题与优化")).toBeVisible();
    await expect(page.getByPlaceholder("随心输入，Codex 为你构建未来")).toBeVisible();
    await page.screenshot({
      path: join(artifactDir, "red-horizon-spec-v1.png"),
      animations: "disabled",
    });
  } finally {
    await cleanup();
  }
});
