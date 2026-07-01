import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import {
  closeApp,
  exportSessionFiles,
  launchAppWithHome,
  persistSessionFixture,
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
      const restored = second.page.getByRole("button", { name: new RegExp(title) });
      await expect(restored).toBeVisible();
      await restored.click();

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
            },
            agents: [
              {
                id: "codex-acp",
                command_override: nodePath,
                args_override: [fakeAcpAgentPath],
                env: [],
              },
            ],
          });
        },
        { nodePath: process.execPath, fakeAcpAgentPath, workspace },
      );

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
        type: "agent_message_chunk",
        data: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: response },
        },
        source: "desktop",
      },
    ]);
    const metadataFiles = await findFiles(join(home, "transcripts"), ".meta.toml");
    expect(metadataFiles).toHaveLength(1);
    const metadata = parseToml(await readFile(metadataFiles[0]!, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(metadata).toMatchObject({
      schema_version: "backchat.session_meta.v1",
      agent_id: "codex-acp",
      title: prompt,
      workdir: workspace,
      pair_id: "",
    });
    expect(typeof metadata.session_id).toBe("string");
    expect(typeof metadata.created_at).toBe("number");
    expect(typeof metadata.last_used_at).toBe("number");

    const second = await launchAppWithHome(home);
    try {
      const restored = second.page.getByRole("button", { name: prompt });
      await expect(restored).toBeVisible();
      await restored.click();

      const transcript = second.page.getByRole("log");
      await expect(transcript.getByText(prompt, { exact: true })).toBeVisible();
      await expect(transcript.getByText(response)).toBeVisible();
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
      const firstRestored = second.page.getByRole("button", {
        name: firstPrompt,
        exact: true,
      });
      await expect(firstRestored).toBeVisible();
      const secondRestored = second.page.getByRole("button", {
        name: secondPrompt,
        exact: true,
      });
      await expect(secondRestored).toBeVisible();

      await firstRestored.click();
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

      await second.page.getByRole("button", { name: "Open command palette" }).click();
      const palette = second.page.getByRole("dialog");
      await second.page
        .getByRole("combobox", { name: "Command palette" })
        .fill("rebuild-token");
      await expect(second.page.getByText("Matches")).toBeVisible();
      await expect(palette.getByText(firstPrompt).first()).toBeVisible();
      await expect(palette.getByText(secondPrompt).first()).toBeVisible();
      await expect(palette.getByText("rebuild-token").first()).toBeVisible();
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
            },
            agents: [
              {
                id: "codex-acp",
                command_override: nodePath,
                args_override: [fakeAcpAgentPath],
                env: [],
              },
            ],
          });
        },
        { nodePath: process.execPath, fakeAcpAgentPath, workspace },
      );

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

      await second.page.getByRole("button", { name: "Open command palette" }).click();
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
            },
            agents: [
              {
                id: "codex-acp",
                command_override: nodePath,
                args_override: [fakeAcpAgentPath],
                env: [],
              },
            ],
          });
        },
        { nodePath: process.execPath, fakeAcpAgentPath, workspace },
      );

      const composer = first.page.locator("textarea").first();
      await composer.fill(prompt);
      await composer.press("Enter");

      const liveTranscript = first.page.getByRole("log");
      await expect(liveTranscript.getByText(prompt, { exact: true })).toBeVisible();
      await expect(liveTranscript.getByText("Internal error")).toBeVisible();
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      const restored = second.page.getByRole("button", { name: prompt });
      await expect(restored).toBeVisible();
      await restored.click();

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
      await expect(
        first.page.getByText(/What can I help with\?|Pick a default agent/),
      ).toBeVisible();
    } finally {
      await closeApp(first.app);
    }

    const second = await launchAppWithHome(home);
    try {
      await expect(
        second.page.getByText(/What can I help with\?|Pick a default agent/),
      ).toBeVisible();
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
      await second.page.getByRole("button", { name: "Open command palette" }).click();
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

      await second.page.getByRole("button", { name: "Open command palette" }).click();
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
      await expect(
        third.page.getByRole("button", { name: title, exact: true }),
      ).toBeVisible();
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
