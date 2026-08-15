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
    expect(translate?.("zh-CN", "sidebar.pairChat")).toBe("多 Agent 对话");
    expect(translate?.("zh-CN", "sidebar.pairs")).toBe("多 Agent 对话");
    expect(translate?.("zh-CN", "sidebar.manageAgents")).toBe("管理 Agent");
    expect(translate?.("en", "sidebar.pairChat")).toBe("Multi-Agent chat");
    expect(translate?.("en", "sidebar.pairs")).toBe("Multi-Agent chats");
    expect(translate?.("en", "settings.available", { count: 3 })).toBe(
      "3 available",
    );
  });

  it("falls back to English for a missing Chinese entry", async () => {
    const { translate } = await loadI18n();

    expect(translate?.("zh-CN", "app.name")).toBe("Backchat");
  });

  it("keeps the original welcome line and uses OpenMA-specific starters", async () => {
    const { translate } = await loadI18n();

    expect(translate?.("en", "chat.whatCanIHelp")).toBe("What can I help with?");
    expect(translate?.("zh-CN", "chat.whatCanIHelp")).toBe("有什么可以帮你？");
    expect(translate?.("en", "chat.suggestionUnderstand")).toBe("Make sense of something");
    expect(translate?.("en", "chat.suggestionShape")).toBe("Shape an idea");
    expect(translate?.("en", "chat.suggestionRefine")).toBe("Improve what I have");
    expect(translate?.("en", "chat.suggestionUnblock")).toBe("Help me get unstuck");
    expect(translate?.("en", "chat.fast")).toBe("Fast");
    expect(translate?.("zh-CN", "chat.fast")).toBe("Fast");
    expect(translate?.("en", "chat.signInToChat")).toBe("Sign in to chat");
    expect(translate?.("zh-CN", "chat.signInToChat")).toBe("请先登录");
    expect(translate?.("en", "chat.signIn")).toBe("Sign in");
    expect(translate?.("zh-CN", "chat.signIn")).toBe("登录");
    expect(translate?.("en", "scheduled.open")).toBe("Open");
    expect(translate?.("zh-CN", "scheduled.open")).toBe("打开");
    expect(translate?.("en", "scheduled.archiveTitle")).toBe(
      "Archive chat and remove scheduled task?",
    );
    expect(translate?.("en", "scheduled.archiveBody", { name: "每天7点闹钟" })).toBe(
      "This chat has an active scheduled task, 每天7点闹钟.",
    );
    expect(translate?.("en", "scheduled.archiveHint")).toBe(
      "Archiving the chat will also remove it and stop future runs.",
    );
    expect(translate?.("en", "scheduled.archiveConfirm")).toBe("Archive and remove");
    expect(translate?.("zh-CN", "scheduled.archiveTitle")).toBe(
      "归档对话并删除定时任务？",
    );
    expect(translate?.("zh-CN", "scheduled.archiveConfirm")).toBe("归档并删除");
    expect(translate?.("en", "scheduled.openSource")).toBe("Open chat");
    expect(translate?.("zh-CN", "scheduled.openSource")).toBe("打开对话");
    expect(translate?.("en", "scheduled.all")).toBe("All");
    expect(translate?.("zh-CN", "scheduled.all")).toBe("全部");
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
    const homeSuggestions = readFileSync(
      resolve(__dirname, "../components/chat/HomeSuggestions.tsx"),
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
    expect(appearance).toMatch(
      /mergeAppearanceSettings\(\s*settings\.appearance,\s*\{\s*language:/,
    );
    expect(homeSuggestions).toContain('t("chat.whatCanIHelp")');
    expect(chatView).toContain("<EmptyStateIntro");
    expect(chatView).toContain('t("chat.reply")');
    expect(sidebar).toContain('data-testid="new-chat-button"');
    expect(e2eHelpers).toContain('getByTestId("new-chat-button")');
  });
});
