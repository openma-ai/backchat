import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { CLAUDE_AGENT_ACP_0_64_2_FIXTURE } from "../src/renderer/src/lib/fixtures/harness-events/claude-agent-acp-0.64.2";
import { KILO_7_4_20_FIXTURE } from "../src/renderer/src/lib/fixtures/harness-events/kilo-7.4.20";
import { OPENCODE_1_18_13_FIXTURE } from "../src/renderer/src/lib/fixtures/harness-events/opencode-1.18.13";
import {
  closeApp,
  enableAgent,
  exportSessionFiles,
  injectEvent,
  launchAppWithHome,
  openCommandPalette,
  openPersistedSession,
  persistSessionFixture,
  reloadRenderer,
  waitForRunnableHarness,
} from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const fakeAcpAgentPath = join(here, "fixtures", "fake-acp-agent.mjs");

test.describe("user-visible storage persistence", () => {
  test("uses an isolated Backchat home for persistent files", async () => {
    const first = await launchAppWithHome(await test.info().outputPath("home"));
    try {
      await expect
        .poll(() => existsSync(join(first.home, "config.toml")))
        .toBe(true);
      await expect
        .poll(() => existsSync(join(first.home, "sessions.db")))
        .toBe(true);
    } finally {
      await first.cleanup();
    }
  });

  test("replays a completed conversation after relaunch", async () => {
    const home = await test.info().outputPath("home");
    const sessionId = "e2e-persist";
    const title = "Remember this: e2e-persistence-token";

    const first = await launchAppWithHome(home);
    try {
      await persistSessionFixture(first.page, {
        sessionId,
        agentId: "codex-acp",
        cwd: join(home, "sessions", sessionId),
        acpSessionId: "",
        title,
        events: [
          {
            type: "user_prompt",
            data: { text: title },
            ts: 1_781_424_000_000,
          },
          {
            type: "agent_message_chunk",
            data: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "The persistence token is saved." },
            },
            ts: 1_781_424_005_000,
          },
        ],
      });
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      await openPersistedSession(second.page, title, sessionId);

      const transcript = second.page.getByRole("log");
      await expect(transcript.getByText(title)).toBeVisible();
      await expect(transcript.getByText("The persistence token is saved.")).toBeVisible();
    } finally {
      await second.cleanup();
    }
  });

  test("replays a UI-created conversation after relaunch", async () => {
    const home = await test.info().outputPath("home");
    const workspace = join(home, "workspace");
    const prompt = "ui-e2e-persistence-token";
    const response = `Fake response saved for ${prompt}.`;

    await mkdir(workspace, { recursive: true });

    const first = await launchAppWithHome(home);
    try {
      await first.page.evaluate(
        async ({ nodePath, fakeAcpAgentPath, workspace }) => {
          // @ts-expect-error — test bridge uses the public settings IPC.
          await window.backchat.settingsPatch({
            default: {
              agent_id: "codex-acp",
              workspace_path: workspace,
              permission_mode: "ask",
              prompt_queue_enabled: true,
            },
            agents: [
              {
                id: "codex-acp",
                enabled: true,
                command_override: nodePath,
                args_override: [fakeAcpAgentPath],
                env: [],
              },
            ],
          });
        },
        { nodePath: process.execPath, fakeAcpAgentPath, workspace },
      );
      await reloadRenderer(first.page);
      await waitForRunnableHarness(first.page);

      await expect(first.page.getByText("What can I help with?")).toBeVisible();
      const composer = first.page.locator("textarea").first();
      await composer.fill(prompt);
      await composer.press("Enter");

      const liveTranscript = first.page.getByRole("log");
      await expect(liveTranscript.getByText(prompt, { exact: true })).toBeVisible();
      await expect(liveTranscript.getByText(response)).toBeVisible();
    } finally {
      await closeApp(first.app);
    }

    const transcriptFiles = await findFiles(join(home, "transcripts"), ".jsonl");
    expect(transcriptFiles).toHaveLength(1);
    const transcriptLines = (await readFile(transcriptFiles[0]!, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(transcriptLines).toMatchObject([
      {
        schema_version: "backchat.session_event.v1",
        seq: 1,
        type: "user_prompt",
        data: { text: prompt },
        source: "desktop",
      },
      {
        schema_version: "backchat.session_event.v1",
        seq: 2,
        type: "openma_event",
        data: {
          schema: "oma.event.v1",
          type: "user.message",
          data: {
            text: prompt,
            input_kind: "prompt",
          },
        },
        source: "desktop",
      },
      {
        schema_version: "backchat.session_event.v1",
        seq: 3,
        type: "openma_event",
        data: {
          schema: "oma.event.v1",
          type: "agent.message_chunk",
          data: {
            text: response,
            content: { type: "text", text: response },
          },
          raw: {
            source: "acp",
            method: "session/update",
            event_type: "agent_message_chunk",
          },
        },
        source: "desktop",
      },
      {
        schema_version: "backchat.session_event.v1",
        seq: 4,
        type: "openma_event",
        data: {
          schema: "oma.event.v1",
          type: "turn.completed",
        },
        source: "desktop",
      },
    ]);
    expect(
      transcriptLines.some((line) => line.type === "agent_message_chunk"),
    ).toBe(false);
    const metadataFiles = await findFiles(join(home, "transcripts"), ".meta.toml");
    expect(metadataFiles).toHaveLength(1);
    const metadata = parseToml(await readFile(metadataFiles[0]!, "utf-8")) as Record<
      string,
      unknown
    >;
    const workdir = String(metadata.workdir ?? "");
    expect(metadata).toMatchObject({
      schema_version: "backchat.session_meta.v1",
      agent_id: "codex-acp",
      title: prompt,
      pair_id: "",
    });
    expect(workdir).toMatch(/[\\/]sessions[\\/]/);
    expect(typeof metadata.session_id).toBe("string");
    expect(typeof metadata.created_at).toBe("number");
    expect(typeof metadata.last_used_at).toBe("number");

    const second = await launchAppWithHome(home);
    try {
      await openPersistedSession(second.page, prompt, basename(workdir));

      const transcript = second.page.getByRole("log");
      await expect(transcript.getByText(prompt, { exact: true })).toBeVisible();
      await expect(transcript.getByText(response)).toBeVisible();
    } finally {
      await second.cleanup();
    }
  });

  test("replays Cursor todo merge semantics through SQL after relaunch", async () => {
    const home = await test.info().outputPath("home");
    const workspace = join(home, "workspace");
    const prompt = "cursor-plan-merge-e2e";
    await mkdir(workspace, { recursive: true });

    let sessionId = "";
    const first = await launchAppWithHome(home);
    try {
      await first.page.evaluate(
        async ({ nodePath, fakeAcpAgentPath, workspace }) => {
          // @ts-expect-error — test setup uses the public settings IPC.
          await window.backchat.settingsPatch({
            default: {
              agent_id: "cursor",
              workspace_path: workspace,
              permission_mode: "ask",
              prompt_queue_enabled: true,
            },
            agents: [
              {
                id: "cursor",
                enabled: true,
                command_override: nodePath,
                args_override: [fakeAcpAgentPath],
                env: [],
              },
            ],
          });
        },
        { nodePath: process.execPath, fakeAcpAgentPath, workspace },
      );
      await reloadRenderer(first.page);
      await waitForRunnableHarness(first.page);

      const composer = first.page.locator("textarea").first();
      await composer.fill(prompt);
      await composer.press("Enter");
      await expect(
        first.page.getByRole("log").getByText(`Fake response saved for ${prompt}.`),
      ).toBeVisible();

      const plan = first.page.locator('[data-plan-activity="true"]');
      await expect(plan).toBeVisible();
      await expect(plan.getByRole("button")).toContainText("2 / 3");
      await plan.getByRole("button").click();
      await expect(plan.locator("li").filter({ hasText: "Audit inputs" })).toBeVisible();
      const runningTask = plan.locator("li").filter({ hasText: "Wire outputs" });
      await expect(runningTask).toBeVisible();
      await expect(plan.locator("li").filter({ hasText: "Verify replay" })).toBeVisible();
      await expect(runningTask).toHaveAttribute("data-task-status", "in_progress");

      const sessions = await first.page.evaluate(() => window.backchat.sessionsList());
      sessionId = sessions.find((session) => session.title === prompt)?.id ?? "";
      expect(sessionId).not.toBe("");
      await expect.poll(() => first.page.evaluate(async (id) => {
        const rows = await window.backchat.sessionsLoadHistory(id);
        return rows.some((row) => {
          if (row.type !== "openma_event") return false;
          try {
            const event = JSON.parse(row.data);
            return event.type === "plan.updated"
              && event.data?.plan_id === "cursor-todos"
              && event.data?.update_mode === "merge"
              && event.data?.entries?.[0]?.id === "todo-1";
          } catch {
            return false;
          }
        });
      }, sessionId)).toBe(true);
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      await openPersistedSession(second.page, prompt, "workspace");
      const plan = second.page.locator('[data-plan-activity="true"]');
      await expect(plan.getByRole("button")).toContainText("2 / 3");
      await plan.getByRole("button").click();
      await expect(plan.locator("li").filter({ hasText: "Audit inputs" })).toBeVisible();
      await expect(plan.locator("li").filter({ hasText: "Wire outputs" })).toBeVisible();
      await expect(plan.locator("li").filter({ hasText: "Verify replay" })).toBeVisible();
    } finally {
      await second.cleanup();
    }
  });

  test("replays OpenCode-family todowrite snapshots through canonical SQL after relaunch", async () => {
    const home = await test.info().outputPath("home");
    const workspace = join(home, "workspace");
    await mkdir(workspace, { recursive: true });
    const cases = [
      {
        agentId: "opencode",
        sessionId: "e2e-opencode-todowrite-replay",
        title: "OpenCode todowrite replay",
        event: OPENCODE_1_18_13_FIXTURE.events.todoWriteStarted,
      },
      {
        agentId: "kilo",
        sessionId: "e2e-kilo-todowrite-replay",
        title: "Kilo todowrite replay",
        event: KILO_7_4_20_FIXTURE.events.todoWriteStarted,
      },
    ] as const;

    const first = await launchAppWithHome(home);
    try {
      for (const item of cases) {
        await persistSessionFixture(first.page, {
          sessionId: item.sessionId,
          agentId: item.agentId,
          cwd: workspace,
          acpSessionId: `acp-${item.sessionId}`,
          title: item.title,
          events: [{ type: "user_prompt", data: { text: "update tasks" } }],
        });
      }
      await reloadRenderer(first.page);

      for (const item of cases) {
        await openPersistedSession(first.page, item.title, "workspace");
        await injectEvent(first.page, {
          type: "session.event",
          session_id: item.sessionId,
          turn_id: `turn-${item.sessionId}`,
          event: item.event,
        });

        const plan = first.page.locator('[data-plan-activity="true"]');
        await expect(plan.getByRole("button")).toContainText("1 / 2");
        await expect.poll(() => first.page.evaluate(async (id) => {
          const rows = await window.backchat.sessionsLoadHistory(id);
          return rows.some((row) => {
            if (row.type !== "openma_event") return false;
            try {
              const event = JSON.parse(row.data);
              return event.type === "plan.updated"
                && event.data?.update_mode === "replace"
                && event.data?.entries?.[1]?.content === "Persist canonical plan";
            } catch {
              return false;
            }
          });
        }, item.sessionId)).toBe(true);
      }
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      for (const item of cases) {
        await openPersistedSession(second.page, item.title, "workspace");
        const plan = second.page.locator('[data-plan-activity="true"]');
        await expect(plan.getByRole("button")).toContainText("1 / 2");
        await plan.getByRole("button").click();
        await expect(
          plan.locator("li").filter({ hasText: "Persist canonical plan" }),
        ).toHaveAttribute("data-task-status", "in_progress");
      }
    } finally {
      await second.cleanup();
    }
  });

  test("replays a correlated Monitor event through SQL after relaunch", async () => {
    const home = await test.info().outputPath("home");
    const workspace = join(home, "workspace");
    const sessionId = "e2e-canonical-monitor-replay";
    const title = "Persistent Monitor activity";
    await mkdir(workspace, { recursive: true });

    const first = await launchAppWithHome(home);
    try {
      await persistSessionFixture(first.page, {
        sessionId,
        agentId: "claude-acp",
        cwd: workspace,
        acpSessionId: "",
        title,
        events: [{ type: "user_prompt", data: { text: "watch production" } }],
      });
      await reloadRenderer(first.page);
      await openPersistedSession(first.page, title, "workspace");

      await injectEvent(first.page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "",
        event: {
          type: "acp.extension_notification",
          method: "_claude/sdkMessage",
          params: {
            sessionId: "acp-canonical-monitor-replay",
            message: {
              type: "user",
              origin: { kind: "task-notification" },
              message: {
                role: "user",
                content:
                  "<task-notification>\n"
                  + "<task-id>persistent-monitor-1</task-id>\n"
                  + "<summary>Monitor event: \"production alerts\"</summary>\n"
                  + "<event>latency threshold crossed</event>\n"
                  + "</task-notification>",
              },
            },
          },
        },
      });

      await expect(
        first.page.locator('[data-activity-module="monitor"]'),
      ).toHaveAttribute("aria-label", "Monitor: 1 event");
      await expect.poll(() => first.page.evaluate(async (id) => {
        const rows = await window.backchat.sessionsLoadHistory(id);
        return rows.some((row) => {
          if (row.type !== "openma_event") return false;
          try {
            const event = JSON.parse(row.data);
            return event.type === "monitor.event"
              && event.work_item_id === "persistent-monitor-1";
          } catch {
            return false;
          }
        });
      }, sessionId)).toBe(true);
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      await openPersistedSession(second.page, title, "workspace");
      const monitor = second.page.locator('[data-activity-module="monitor"]');
      await expect(monitor).toHaveAttribute("aria-label", "Monitor: 1 event");
      await monitor.click();
      await expect(second.page.getByText("production alerts", { exact: true })).toBeVisible();
      await expect(
        second.page.getByText("latency threshold crossed", { exact: true }),
      ).toBeVisible();
    } finally {
      await second.cleanup();
    }
  });

  test("replays Claude Monitor and native Agent lifecycle through SQL after relaunch", async () => {
    const home = await test.info().outputPath("home");
    const workspace = join(home, "workspace");
    const sessionId = "e2e-claude-runtime-replay";
    const turnId = "turn-claude-runtime-replay";
    const title = "Claude runtime lifecycle replay";
    await mkdir(workspace, { recursive: true });

    const first = await launchAppWithHome(home);
    try {
      await enableAgent(first.page, "claude-acp");
      await persistSessionFixture(first.page, {
        sessionId,
        agentId: "claude-acp",
        cwd: workspace,
        acpSessionId: "acp-claude-runtime-replay",
        title,
        events: [{ type: "user_prompt", data: { text: "delegate and watch" } }],
      });
      await reloadRenderer(first.page);
      await openPersistedSession(first.page, title, "workspace");

      const events = [
        // Plugin-created Monitor has no ordinary Monitor tool result. Its
        // generic local_bash task becomes identifiable on the first delivery.
        CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorTaskStarted,
        CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorDelivery,
        CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorTaskCompleted,
        CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.subagentTaskStarted,
        CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.subagentTaskProgress,
        CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.subagentMessage,
        CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.subagentTaskCompleted,
      ];
      for (const event of events) {
        await injectEvent(first.page, {
          type: "session.event",
          session_id: sessionId,
          turn_id: turnId,
          event,
        });
      }

      await expect(
        first.page.locator('[data-activity-module="monitor"]'),
      ).toHaveAttribute("aria-label", "Monitor: 1 completed · 1 event");
      await expect.poll(() => first.page.evaluate(async (id) => {
        const rows = await window.backchat.sessionsLoadHistory(id);
        return rows.flatMap((row) => {
          if (row.type !== "openma_event") return [];
          try {
            const event = JSON.parse(row.data);
            return [{ type: event.type, workItemId: event.work_item_id }];
          } catch {
            return [];
          }
        });
      }, sessionId)).toEqual(expect.arrayContaining([
        { type: "work_item.started", workItemId: "monitor-task-9" },
        { type: "work_item.classified", workItemId: "monitor-task-9" },
        { type: "monitor.event", workItemId: "monitor-task-9" },
        { type: "work_item.completed", workItemId: "monitor-task-9" },
        { type: "work_item.started", workItemId: "agent-task-42" },
        { type: "work_item.progress", workItemId: "agent-task-42" },
        { type: "agent.message_chunk", workItemId: "agent-task-42" },
        { type: "work_item.completed", workItemId: "agent-task-42" },
      ]));
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      await openPersistedSession(second.page, title, "workspace");
      await expect(
        second.page.locator('[data-activity-module="monitor"]'),
      ).toHaveAttribute("aria-label", "Monitor: 1 completed · 1 event");

      const agentRow = second.page
        .locator('[data-resource-category="agents"]')
        .getByRole("button", { name: "Audit renderer event handling" });
      if (!(await agentRow.isVisible())) {
        const openSidePanel = second.page.getByRole("button", {
          name: "Open side panel",
        });
        if (await openSidePanel.isVisible()) await openSidePanel.click();
        const newTab = second.page.getByRole("button", {
          name: "New tab",
          exact: true,
        });
        if (await newTab.isVisible()) await newTab.click();
      }
      await expect(agentRow).toHaveAttribute(
        "title",
        "Audit renderer event handling\ncompleted · 1,234 tokens",
      );
      await agentRow.click();
      await expect(
        second.page.getByText("Child located the canonical boundary.", { exact: true }),
      ).toBeVisible();
    } finally {
      await second.cleanup();
    }
  });

  test("rebuilds visible history from transcript files when the SQLite index is missing", async () => {
    const home = await test.info().outputPath("home");
    const workspace = join(home, "workspace");
    const firstPrompt = "file-primary-rebuild-token";
    const secondPrompt = "second-file-primary-rebuild-token";

    await mkdir(workspace, { recursive: true });

    const first = await launchAppWithHome(home);
    try {
      await persistSessionFixture(first.page, {
        sessionId: "e2e-rebuild-first",
        agentId: "codex-acp",
        cwd: workspace,
        title: firstPrompt,
        events: [
          { type: "user_prompt", data: { text: firstPrompt } },
          {
            type: "agent_message_chunk",
            data: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: `Fake response saved for ${firstPrompt}.`,
              },
            },
          },
        ],
      });
      await persistSessionFixture(first.page, {
        sessionId: "e2e-rebuild-second",
        agentId: "codex-acp",
        cwd: workspace,
        title: secondPrompt,
        events: [
          { type: "user_prompt", data: { text: secondPrompt } },
          {
            type: "agent_message_chunk",
            data: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: `Fake response saved for ${secondPrompt}.`,
              },
            },
          },
        ],
      });
      await exportSessionFiles(first.page, { overwrite: true });
    } finally {
      await closeApp(first.app);
    }

    const transcriptFiles = await findFiles(join(home, "transcripts"), ".jsonl");
    expect(transcriptFiles).toHaveLength(2);
    for (const transcriptFile of transcriptFiles) {
      const seqs = (await readJsonl(transcriptFile)).map((event) => event.seq);
      expect(seqs).toEqual([1, 2]);
    }
    expect(await findFiles(join(home, "transcripts"), ".meta.toml")).toHaveLength(2);
    await removeSqliteIndex(home);

    const second = await launchAppWithHome(home);
    try {
      const firstRestored = await openPersistedSession(
        second.page,
        firstPrompt,
        "workspace",
      );
      const secondRestored = second.page.getByRole("button", {
        name: secondPrompt,
        exact: true,
      });
      await expect(secondRestored).toBeVisible();

      const transcript = second.page.getByRole("log");
      await expect(transcript.getByText(firstPrompt, { exact: true })).toBeVisible();
      await expect(
        transcript.getByText(`Fake response saved for ${firstPrompt}.`),
      ).toBeVisible();

      await secondRestored.click();
      await expect(transcript.getByText(secondPrompt, { exact: true })).toBeVisible();
      await expect(
        transcript.getByText(`Fake response saved for ${secondPrompt}.`),
      ).toBeVisible();

      const palette = await openCommandPalette(second.page);
      await second.page
        .getByRole("combobox", { name: "Command palette" })
        .fill("rebuild-token");
      await expect(palette.getByText(firstPrompt).first()).toBeVisible({ timeout: 15_000 });
      await expect(palette.getByText(secondPrompt).first()).toBeVisible({ timeout: 15_000 });
      await expect(palette.getByText("rebuild-token").first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await second.cleanup();
    }
  });

  test("does not resurrect a hard-deleted session after rebuilding the SQLite index", async () => {
    const home = await test.info().outputPath("home");
    const workspace = join(home, "workspace");
    const prompt = "hard-delete-rebuild-token";

    await mkdir(workspace, { recursive: true });

    const first = await launchAppWithHome(home);
    try {
      await first.page.evaluate(
        async ({ nodePath, fakeAcpAgentPath, workspace }) => {
          // @ts-expect-error — test bridge uses the public settings IPC.
          await window.backchat.settingsPatch({
            default: {
              agent_id: "codex-acp",
              workspace_path: workspace,
              permission_mode: "ask",
              prompt_queue_enabled: true,
            },
            agents: [
              {
                id: "codex-acp",
                enabled: true,
                command_override: nodePath,
                args_override: [fakeAcpAgentPath],
                env: [],
              },
            ],
          });
        },
        { nodePath: process.execPath, fakeAcpAgentPath, workspace },
      );
      await reloadRenderer(first.page);
      await waitForRunnableHarness(first.page);

      const composer = first.page.locator("textarea").first();
      await composer.fill(prompt);
      await composer.press("Enter");

      const liveTranscript = first.page.getByRole("log");
      await expect(liveTranscript.getByText(prompt, { exact: true })).toBeVisible();
      await expect(liveTranscript.getByText(`Fake response saved for ${prompt}.`)).toBeVisible();

      const sessionId = await first.page.evaluate(async (title) => {
        const sessions = await window.backchat.sessionsList(20);
        const session = sessions.find((s) => s.title === title);
        if (!session) throw new Error(`missing persisted session ${title}`);
        await window.backchat.sessionsArchive({ session_id: session.id });
        await window.backchat.sessionsDelete({ session_id: session.id });
        return session.id;
      }, prompt);
      expect(sessionId).toBeTruthy();
    } finally {
      await closeApp(first.app);
    }

    expect(await findFiles(join(home, "transcripts"), ".jsonl")).toHaveLength(0);
    expect(await findFiles(join(home, "transcripts"), ".meta.toml")).toHaveLength(0);
    await removeSqliteIndex(home);

    const second = await launchAppWithHome(home);
    try {
      await expect(
        second.page.getByRole("button", { name: prompt, exact: true }),
      ).toBeHidden();

      await openCommandPalette(second.page);
      await second.page
        .getByRole("combobox", { name: "Command palette" })
        .fill("hard-delete-rebuild-token");
      const palette = second.page.getByRole("dialog");
      await expect(palette.getByText("Matches")).toBeHidden();
      await expect(palette.getByRole("option", { name: new RegExp(prompt) })).toHaveCount(0);
    } finally {
      await second.cleanup();
    }
  });

  test("replays the submitted prompt after a turn error", async () => {
    const home = await test.info().outputPath("home");
    const workspace = join(home, "workspace");
    const prompt = "fail-after-accept-e2e";
    const response = `Fake response saved for ${prompt}.`;

    await mkdir(workspace, { recursive: true });

    const first = await launchAppWithHome(home);
    try {
      await first.page.evaluate(
        async ({ nodePath, fakeAcpAgentPath, workspace }) => {
          // @ts-expect-error — test bridge uses the public settings IPC.
          await window.backchat.settingsPatch({
            default: {
              agent_id: "codex-acp",
              workspace_path: workspace,
              permission_mode: "ask",
              prompt_queue_enabled: true,
            },
            agents: [
              {
                id: "codex-acp",
                enabled: true,
                command_override: nodePath,
                args_override: [fakeAcpAgentPath],
                env: [],
              },
            ],
          });
        },
        { nodePath: process.execPath, fakeAcpAgentPath, workspace },
      );
      await reloadRenderer(first.page);
      await waitForRunnableHarness(first.page);

      const composer = first.page.locator("textarea").first();
      await composer.fill(prompt);
      await composer.press("Enter");

      const liveTranscript = first.page.getByRole("log");
      await expect(liveTranscript.getByText(prompt, { exact: true })).toBeVisible();
      await expect(liveTranscript.getByText("Internal error")).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      const metadataFiles = await findFiles(join(home, "transcripts"), ".meta.toml");
      expect(metadataFiles).toHaveLength(1);
      const metadata = parseToml(await readFile(metadataFiles[0]!, "utf-8")) as Record<string, unknown>;
      await openPersistedSession(second.page, prompt, basename(String(metadata.workdir)));

      const transcript = second.page.getByRole("log");
      await expect(transcript.getByText(prompt, { exact: true })).toBeVisible();
      await expect(transcript.getByText(response)).toBeHidden();
    } finally {
      await second.cleanup();
    }
  });

  test("does not restore an empty draft as a durable session", async () => {
    const home = await test.info().outputPath("home");

    const first = await launchAppWithHome(home);
    try {
      await first.page.getByRole("button", { name: "New chat", exact: true }).click();
      await expect(first.page.getByRole("heading", { name: "Pick an agent" })).toBeVisible();
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      await expect(second.page.getByRole("heading", { name: "Pick an agent" })).toBeVisible();
      await expect(
        second.page.getByRole("navigation").getByRole("listitem"),
      ).toHaveCount(0);
    } finally {
      await second.cleanup();
    }
  });

  test("finds persisted prose in command palette search after relaunch", async () => {
    const home = await test.info().outputPath("home");
    const sessionId = "e2e-search";
    const title = "Search target chat";
    const token = "searchable-persistence-token";

    const first = await launchAppWithHome(home);
    try {
      await persistSessionFixture(first.page, {
        sessionId,
        agentId: "codex-acp",
        cwd: join(home, "sessions", sessionId),
        acpSessionId: "",
        title,
        events: [
          {
            type: "user_prompt",
            data: { text: `Please remember ${token}` },
          },
          {
            type: "agent_message",
            data: { text: `Stored ${token} for command palette search.` },
          },
        ],
      });
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      await openCommandPalette(second.page);
      await second.page
        .getByRole("combobox", { name: "Command palette" })
        .fill(token);

      const palette = second.page.getByRole("dialog");
      await expect(second.page.getByText("Matches")).toBeVisible();
      await expect(palette.getByText(title).first()).toBeVisible();
      await expect(palette.getByText(token).first()).toBeVisible();

      await palette.getByRole("option", { name: new RegExp(title) }).first().click();

      const transcript = second.page.getByRole("log");
      await expect(transcript.getByText(`Please remember ${token}`)).toBeVisible();
      await expect(
        transcript.getByText(`Stored ${token} for command palette search.`),
      ).toBeVisible();
    } finally {
      await second.cleanup();
    }
  });

  test("finds archived prose in command palette search after relaunch", async () => {
    const home = await test.info().outputPath("home");
    const sessionId = "e2e-archived-search";
    const title = "Archived search target chat";
    const token = "archived-searchable-persistence-token";

    const first = await launchAppWithHome(home);
    try {
      await persistSessionFixture(first.page, {
        sessionId,
        agentId: "codex-acp",
        cwd: join(home, "sessions", sessionId),
        acpSessionId: "",
        title,
        events: [
          {
            type: "user_prompt",
            data: { text: `Archive should still find ${token}` },
          },
          {
            type: "agent_message",
            data: { text: `Stored archived ${token} for command palette search.` },
          },
        ],
      });
      await first.page.evaluate(async (session_id) => {
        await window.backchat.sessionsArchive({ session_id });
      }, sessionId);
    } finally {
      await closeApp(first.app);
    }

    const metadataFiles = await findFiles(join(home, "transcripts"), ".meta.toml");
    expect(metadataFiles).toHaveLength(1);
    const metadata = parseToml(await readFile(metadataFiles[0]!, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(metadata).not.toHaveProperty("archived_at");
    expect(metadata).not.toHaveProperty("pinned_at");

    const second = await launchAppWithHome(home);
    try {
      await expect(
        second.page.getByRole("button", { name: title, exact: true }),
      ).toBeHidden();

      await openCommandPalette(second.page);
      await second.page
        .getByRole("combobox", { name: "Command palette" })
        .fill(token);

      const palette = second.page.getByRole("dialog");
      await expect(second.page.getByText("Matches")).toBeVisible();
      await expect(palette.getByText(title).first()).toBeVisible();
      await expect(palette.getByText(token).first()).toBeVisible();
    } finally {
      await closeApp(second.app);
    }

    await removeSqliteIndex(home);

    const third = await launchAppWithHome(home);
    try {
      await openPersistedSession(third.page, title, sessionId);
    } finally {
      await third.cleanup();
    }
  });
});

async function findFiles(root: string, suffix: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...await findFiles(path, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(path);
    }
  }
  return out.sort();
}

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(path, "utf-8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function removeSqliteIndex(home: string): Promise<void> {
  await Promise.all([
    rm(join(home, "sessions.db"), { force: true }),
    rm(join(home, "sessions.db-wal"), { force: true }),
    rm(join(home, "sessions.db-shm"), { force: true }),
  ]);
}
