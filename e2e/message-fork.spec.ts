import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  reloadRenderer,
  waitForComposerSubmitReady,
  waitForRunnableHarness,
} from "./helpers";

const fakeAcpAgentPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-acp-agent.mjs",
);

type ForkLevel = "none" | "session" | "message";

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
  await waitForComposerSubmitReady(page);
  await input.press("Enter");
  await expect(page.getByText(`Fake response saved for ${text}.`).last()).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("message fork with the local fake ACP agent", () => {
  test("shows no fork button when the agent advertises neither", async ({ page, capture }) => {
    await useFakeAgent(page, "none", "/tmp/backchat-fork-none.jsonl");
    await sendPrompt(page, "fork-none");

    await expect(page.locator("[data-fork-support='none']")).toBeVisible();
    await expect(page.locator("[data-turn-fork-action='true']")).toHaveCount(0);
    await expect(page.locator("[data-turn-footer='true']")).toHaveCount(1);
    await capture("fork-level-none.png", "fork level none");
  });

  test("session fork shows inherited parent turns before the first child prompt", async ({ page, capture }) => {
    await useFakeAgent(page, "session", "/tmp/backchat-fork-inherit.jsonl");
    await sendPrompt(page, "inherit-parent-turn");
    await page.locator("[data-turn-fork-action='true']").click();
    await expect(page.getByText("inherit-parent-turn")).toBeVisible();
    await capture("gui-bugfix-fork-inherited.png", "fork draft shows parent prompt");
  });

  test("shows one whole-session fork button on the last reply", async ({ page, capture }) => {
    await useFakeAgent(page, "session", "/tmp/backchat-fork-session.jsonl");
    await sendPrompt(page, "fork-session");

    await expect(page.locator("[data-fork-support='session']")).toBeVisible();
    const forks = page.locator("[data-turn-fork-action='true']");
    await expect(forks).toHaveCount(1);
    await expect(forks).toHaveAttribute("data-fork-kind", "session");
    await expect(forks).toHaveAttribute("title", "Continue in new chat");
    await expect(forks.locator('[data-backchat-icon="branch"]')).toHaveCount(1);
    await expect(forks.locator(".lucide-arrow-right-from-line")).toHaveCount(0);
    await expect(page.locator("[data-turn-footer='true']").locator("[data-turn-fork-action='true']")).toHaveCount(1);
    await capture("fork-level-session.png", "one whole-session fork button");
  });

  test("forks from an earlier reply and sends jetbrains.air.fork", async ({ page, capture }, testInfo) => {
    test.setTimeout(90_000);
    const logPath = testInfo.outputPath("fork-requests.jsonl");
    await mkdir(dirname(logPath), { recursive: true });
    await useFakeAgent(page, "message", logPath);
    await sendPrompt(page, "fork-alpha");
    await sendPrompt(page, "fork-beta");

    await expect(page.locator("[data-fork-support='message']")).toBeVisible();
    const forks = page.locator("[data-turn-fork-action='true']");
    await expect(forks).toHaveCount(2);
    await expect(forks.nth(0)).toHaveAttribute("data-fork-kind", "message");
    await expect(forks.nth(1)).toHaveAttribute("data-fork-kind", "message");
    await expect(forks.nth(0)).toHaveAttribute("title", "Fork from here");
    await expect(forks.nth(1)).toHaveAttribute("title", "Fork from here");
    await expect(forks.locator('[data-backchat-icon="branch"]')).toHaveCount(2);
    await expect(page.locator("[data-turn-fork-action='true'] .lucide-arrow-right-from-line")).toHaveCount(0);
    const footers = page.locator("[data-turn-footer='true']");
    await expect(footers).toHaveCount(2);
    await expect(footers.nth(0).locator("[data-turn-fork-action='true']")).toHaveCount(1);
    await expect(footers.nth(1).locator("[data-turn-fork-action='true']")).toHaveCount(1);
    await capture("fork-level-message.png", "one fork button on each reply, including the last");

    await forks.nth(0).click();
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

    await page.locator("[data-turn-fork-action='true']").click();
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

  test("fork keeps a managed cwd and the same project cwd", async ({ page, capture }) => {
    test.setTimeout(120_000);
    const projectDir = await mkdtemp(join(tmpdir(), "backchat-fork-project-"));
    const decoyDir = `${projectDir}-decoy`;
    await mkdir(decoyDir);
    await page.evaluate(async (dir) => {
      await window.backchat.projectSave({
        project_id: "fork-kept-project",
        name: "Kept project",
        primary_folder: dir,
        source_folders: [dir],
      });
      await window.backchat.projectSave({
        project_id: "fork-decoy-project",
        name: "Decoy project",
        primary_folder: `${dir}-decoy`,
        source_folders: [`${dir}-decoy`],
      });
    }, projectDir);
    await useFakeAgent(page, "session", "/tmp/backchat-fork-cwd.jsonl");
    await page.evaluate((dir) => {
      localStorage.setItem("backchat:last-project-directory:v1", `${dir}-decoy`);
    }, projectDir);

    await sendPrompt(page, "fork-managed-source");
    const parent = await page.evaluate(async () => {
      const sessions = await window.backchat.sessionsList();
      return sessions.find((session) => session.title === "fork-managed-source") ?? null;
    });
    expect(parent?.project_id ?? null).toBeNull();
    expect(parent?.cwd ?? "").toContain("/sessions/");

    await page.locator("[data-turn-fork-action='true']").click();
    const chip = page.locator('[data-composer-footer-control="project"]');
    await expect(page.locator(".new-chat-page")).toBeVisible();
    await chip.click();
    await expect(page.getByRole("option", { name: /Decoy project/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chip).toContainText("Choose project");
    await expect(chip).not.toContainText("Decoy project");
    await capture("fork-managed-cwd.png", "managed fork does not adopt the last project");

    const managedDraft = page.locator(".new-chat-page textarea").last();
    await managedDraft.fill("fork-managed-child");
    await managedDraft.press("Enter");
    await expect(page.getByText("Fake response saved for fork-managed-child.").last()).toBeVisible({
      timeout: 20_000,
    });
    const managedChild = await page.evaluate(async (parentId) => {
      const sessions = await window.backchat.sessionsList();
      return sessions.find((session) => session.parent_session_id === parentId) ?? null;
    }, parent!.id);
    expect(managedChild?.fork_kind).toBe("session");
    expect(managedChild?.project_id ?? null).toBeNull();
    expect(managedChild?.cwd ?? "").toContain("/sessions/");
    expect(managedChild?.cwd).not.toBe(parent!.cwd);
    expect(managedChild?.cwd).not.toContain("decoy");

    await page.getByTestId("new-chat-button").click();
    await expect(page.locator(".new-chat-page")).toBeVisible();
    await chip.click();
    await page.getByRole("option", { name: /Kept project/ }).click();
    await expect(chip).toContainText("Kept project");
    await sendPrompt(page, "fork-project-source");
    const projectParent = await page.evaluate(async () => {
      const sessions = await window.backchat.sessionsList();
      return sessions.find((session) => session.title === "fork-project-source") ?? null;
    });
    expect(projectParent?.cwd).toBe(projectDir);

    await page.locator("[data-turn-fork-action='true']").click();
    await expect(page.locator(".new-chat-page")).toBeVisible();
    await expect(chip).toContainText("Kept project");
    await expect(chip).not.toContainText("Decoy project");
    await capture("fork-project-cwd.png", "project fork keeps the same project");

    const projectDraft = page.locator(".new-chat-page textarea").last();
    await projectDraft.fill("fork-project-child");
    await projectDraft.press("Enter");
    await expect(page.getByText("Fake response saved for fork-project-child.").last()).toBeVisible({
      timeout: 20_000,
    });
    const projectChild = await page.evaluate(async (parentId) => {
      const sessions = await window.backchat.sessionsList();
      return sessions.find((session) => session.parent_session_id === parentId) ?? null;
    }, projectParent!.id);
    expect(projectChild?.fork_kind).toBe("session");
    expect(projectChild?.parent_session_id).toBe(projectParent!.id);
    expect(projectChild?.cwd).toBe(projectDir);
  });

  test("clears the source composer after /fork", async ({ page, capture }) => {
    test.setTimeout(90_000);
    await useFakeAgent(page, "session", "/tmp/backchat-fork-slash.jsonl");
    await sendPrompt(page, "fork-slash-source");

    const source = page.locator('[data-chat-surface="main"] textarea').last();
    await source.pressSequentially("/fork");
    const menu = page.getByRole("listbox", { name: "Slash commands" });
    await expect(menu).toBeVisible();
    await source.press("Enter");

    await expect(page.locator(".new-chat-page textarea").last()).toBeVisible();
    await page.getByRole("button", { name: "fork-slash-source" }).click();
    const returned = page.locator('[data-chat-surface="main"] textarea').last();
    await expect(returned).toBeVisible();
    await expect(returned).toHaveValue("");
    await expect(page.getByRole("listbox", { name: "Slash commands" })).toHaveCount(0);
    await capture("fork-slash-cleared.png", "source composer cleared after /fork");
  });
});
