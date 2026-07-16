/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type I18nModule = {
  resolveLocale?: (
    preference: "system" | "en" | "zh-CN",
    systemLocales: readonly string[],
  ) => "en" | "zh-CN";
  translate?: (
    locale: "en" | "zh-CN",
    key: string,
    values?: Record<string, string | number>,
  ) => string;
};

async function loadI18n(): Promise<I18nModule> {
  return import("./i18n").catch(() => ({}));
}

describe("i18n", () => {
  it("resolves system Chinese variants and otherwise falls back to English", async () => {
    const { resolveLocale } = await loadI18n();

    expect(resolveLocale?.("system", ["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveLocale?.("system", ["en-US"])).toBe("en");
    expect(resolveLocale?.("zh-CN", ["en-US"])).toBe("zh-CN");
  });

  it("translates shell labels and interpolates values", async () => {
    const { translate } = await loadI18n();

    expect(translate?.("zh-CN", "sidebar.pinned")).toBe("置顶");
    expect(translate?.("en", "settings.available", { count: 3 })).toBe(
      "3 available",
    );
  });

  it("falls back to English for a missing Chinese entry", async () => {
    const { translate } = await loadI18n();

    expect(translate?.("zh-CN", "app.name")).toBe("Backchat");
  });

  it("persists a language preference in appearance settings", () => {
    const sharedSettings = readFileSync(
      resolve(__dirname, "../../../shared/settings.ts"),
      "utf8",
    );
    const mainSettings = readFileSync(
      resolve(__dirname, "../../../main/settings-store.ts"),
      "utf8",
    );

    expect(sharedSettings).toContain('language: "system" | "en" | "zh-CN";');
    expect(mainSettings).toContain(
      'language: z.enum(["system", "en", "zh-CN"]).default("system")',
    );
  });

  it("wires translations into the primary shell and language settings", () => {
    const sidebar = readFileSync(
      resolve(__dirname, "../components/shell/Sidebar.tsx"),
      "utf8",
    );
    const settingsLayout = readFileSync(
      resolve(__dirname, "../pages/settings/SettingsLayout.tsx"),
      "utf8",
    );
    const appearance = readFileSync(
      resolve(__dirname, "../pages/settings/Appearance.tsx"),
      "utf8",
    );
    const chatView = readFileSync(
      resolve(__dirname, "../components/chat/ChatView.tsx"),
      "utf8",
    );
    const e2eHelpers = readFileSync(
      resolve(__dirname, "../../../../e2e/helpers.ts"),
      "utf8",
    );

    expect(sidebar).toContain('t("sidebar.pinned")');
    expect(sidebar).toContain('t("sidebar.newChat")');
    expect(settingsLayout).toContain('labelKey: "settings.appearance"');
    expect(settingsLayout).toContain("t(tab.labelKey)");
    expect(appearance).toContain('appearance: { ...settings.appearance, language:');
    expect(chatView).toContain('t("chat.whatCanIHelp")');
    expect(chatView).toContain('t("chat.reply")');
    expect(sidebar).toContain('data-testid="new-chat-button"');
    expect(e2eHelpers).toContain('getByTestId("new-chat-button")');
  });
});
