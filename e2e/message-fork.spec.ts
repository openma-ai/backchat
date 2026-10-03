import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { forkSupport } from "@openma/common/acp-runtime";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { reloadRenderer, waitForRunnableHarness } from "./helpers";

const fakeAcpAgentPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-acp-agent.mjs",
);

type ForkLevel = "none" | "session" | "message";

function supportFor(level: ForkLevel) {
  return forkSupport({
    agentInfo: { name: "fake-acp-agent", version: "0.0.0-e2e" },
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: {
        resume: {},
        ...(level === "none" ? {} : { fork: {} }),
      },
      ...(level === "message"
        ? { _meta: { jetbrains: { air: { fork: { version: 1, inclusive: true } } } } }
        : {}),
    },
  });
}

async function useFakeAgent(
  page: Page,
  level: ForkLevel,
  logPath: string,
  reject = false,
) {
  await page.evaluate(async ({ nodePath, fakeAgentPath, level, logPath, reject }) => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, language: "en" },
      agents: [{
        id: "codex-acp",
        enabled: true,
        command_override: nodePath,
        args_override: [fakeAgentPath],
        env: [
          { name: "BACKCHAT_FAKE_FORK", value: level },
          { name: "BACKCHAT_FAKE_FORK_LOG", value: logPath },
          ...(reject ? [{ name: "BACKCHAT_FAKE_FORK_REJECT", value: "not-found" }] : []),
        ],
      }],
    });
  }, {
    nodePath: process.execPath,
    fakeAgentPath: fakeAcpAgentPath,
    level,
    logPath,
    reject,
  });
  await reloadRenderer(page);
  await waitForRunnableHarness(page);
}

async function sendPrompt(page: Page, text: string) {
  const draft = page.locator(".new-chat-page textarea").last();
  const chat = page.locator('[data-chat-surface="main"] textarea').last();
  const input = await draft.count() > 0 && await draft.isVisible() ? draft : chat;
  await input.fill(text);
  await input.press("Enter");
  await expect(page.getByText(`Fake response saved for ${text}.`).last()).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("message fork with the local fake ACP agent", () => {
  test("hides whole-session fork and disables message fork when the agent advertises neither", async ({ page, capture }) => {
    await useFakeAgent(page, "none", "/tmp/backchat-fork-none.jsonl");
    await sendPrompt(page, "fork-none");

    await expect(page.locator("[data-fork-support='none']")).toBeVisible();
    const messageFork = page.locator("[data-turn-message-fork='true']");
    await expect(messageFork).toHaveCount(1);
    await expect(messageFork).toBeDisabled();
    await expect(messageFork).toHaveAttribute("title", supportFor("none").message);
    await expect(page.locator("[data-turn-fork-action='true']")).toHaveCount(0);
    await capture("fork-level-none.png", "fork level none");
  });

  test("disables message fork and keeps whole-session fork when only session fork is advertised", async ({ page, capture }) => {
    await useFakeAgent(page, "session", "/tmp/backchat-fork-session.jsonl");
    await sendPrompt(page, "fork-session");

    await expect(page.locator("[data-fork-support='session']")).toBeVisible();
    const messageFork = page.locator("[data-turn-message-fork='true']");
    await expect(messageFork).toHaveCount(1);
    await expect(messageFork).toBeDisabled();
    await expect(messageFork).toHaveAttribute("title", supportFor("session").message);
    await expect(page.locator("[data-turn-fork-action='true']")).toHaveCount(1);
    await capture("fork-level-session.png", "fork level session");
  });

  test("forks from an earlier reply and sends jetbrains.air.fork", async ({ page, capture }, testInfo) => {
    test.setTimeout(90_000);
    const logPath = testInfo.outputPath("fork-requests.jsonl");
    await mkdir(dirname(logPath), { recursive: true });
    await useFakeAgent(page, "message", logPath);
    await sendPrompt(page, "fork-alpha");
    await sendPrompt(page, "fork-beta");

    await expect(page.locator("[data-fork-support='message']")).toBeVisible();
    const messageForks = page.locator("[data-turn-message-fork='true']");
    await expect(messageForks).toHaveCount(2);
    await expect(messageForks.nth(0)).toBeEnabled();
    await expect(messageForks.nth(1)).toBeEnabled();
    await expect(messageForks.nth(0)).toHaveAttribute("title", "Fork from here");
    await expect(page.locator("[data-turn-fork-action='true']")).toHaveCount(1);
    await capture("fork-level-message.png", "fork from here on each completed turn");

    await messageForks.nth(0).click();
    const draft = page.locator(".new-chat-page textarea").last();
    await expect(draft).toBeVisible();
    await draft.fill("fork-followup");
    await draft.press("Enter");

    const text = "Fake response saved for fork-alpha.";
    const fingerprint = `sha256:${createHash("sha256").update(text).digest("hex")}`;
    let logged = "";
    await expect.poll(async () => {
      try {
        logged = await readFile(logPath, "utf8");
      } catch {
        logged = "";
      }
      return logged.trim().split("\n").filter(Boolean).length;
    }, { timeout: 20_000 }).toBe(1);
    const request = JSON.parse(logged.trim()) as {
      _meta?: {
        jetbrains?: {
          air?: {
            fork?: {
              version?: number;
              messageId?: string;
              messageFingerprint?: string;
              messageOccurrence?: number;
            };
          };
        };
      };
    };
    expect(request._meta?.jetbrains?.air?.fork).toEqual({
      version: 1,
      messageId: "fake-assistant-1",
      messageFingerprint: fingerprint,
      messageOccurrence: 1,
    });
    await expect(page.getByText("Fake response saved for fork-followup.").last()).toBeVisible({
      timeout: 20_000,
    });
    await capture("fork-from-message-result.png", "forked session reply");
  });

  test("shows the agent invalidParams error instead of forking the whole session", async ({ page, capture }, testInfo) => {
    test.setTimeout(90_000);
    const logPath = testInfo.outputPath("fork-rejected.jsonl");
    await mkdir(dirname(logPath), { recursive: true });
    await useFakeAgent(page, "message", logPath, true);
    await sendPrompt(page, "fork-reject");

    await page.locator("[data-turn-message-fork='true']").click();
    const draft = page.locator(".new-chat-page textarea").last();
    await expect(draft).toBeVisible();
    await draft.fill("fork-should-fail");
    await draft.press("Enter");

    await expect(page.getByText(/was not found/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Fake response saved for fork-should-fail.")).toHaveCount(0);
    const logged = await readFile(logPath, "utf8");
    const lines = logged.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const request = JSON.parse(lines[0]!) as {
      _meta?: { jetbrains?: { air?: { fork?: { messageId?: string } } } };
    };
    expect(request._meta?.jetbrains?.air?.fork?.messageId).toBe("fake-assistant-1");
    await capture("fork-point-not-found.png", "fork point was not found");
  });
});
