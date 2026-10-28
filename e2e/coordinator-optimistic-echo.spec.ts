import { expect, test } from "./fixtures";
import { fileURLToPath } from "node:url";
import { reloadRenderer, waitForRunnableHarness, persistSessionFixture } from "./helpers";

test("coordinator chat shows the user message before the host accepts it", async ({ page, capture, app }) => {
  await page.evaluate(async ({ node, agent }) => {
    await window.backchat.settingsPatch({ agents: [{ id: "codex-acp", enabled: true, command_override: node, args_override: [agent], env: [] }] });
  }, { node: process.execPath, agent: fileURLToPath(new URL("./fixtures/fake-acp-agent.mjs", import.meta.url)) });
  await reloadRenderer(page);
  await waitForRunnableHarness(page);
  await page.evaluate(async () => {
    await window.backchat.projectSave({
      project_id: "optimistic-coordinator",
      name: "Optimistic coordinator",
      source_folders: [],
    });
    await window.backchat.projectWorkSave({
      projectId: "optimistic-coordinator",
      description: "",
      instructions: "",
      context: "",
      resources: [],
      coordinatorAgent: "codex-acp",
      workerAgent: "codex-acp",
      continuity: "per-scope",
      controls: ["delegate", "steer", "cancel", "complete"],
      execution: { kind: "local" },
    });
  });
  await page.reload();
  await expect(page.getByPlaceholder("Ask anything…")).toBeVisible();
  await capture("normal-chat.png", "Normal chat composer");
  const project = page.locator('[data-sidebar-project="project:optimistic-coordinator"]');
  await project.getByRole("button", { name: "Expand project: Optimistic coordinator" }).click();
  await project.locator('[data-sidebar-grid="label"] button').click();
  const composer = page.getByLabel("Message coordinator", { exact: true });
  await expect(composer).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setBounds({ x: 40, y: 40, width: 1280, height: 800 });
    win.show();
    win.focus();
  });

  const message = "OPTIMISTIC-9417";
  await page.evaluate(() => {
    const trace = { enterAt: 0, shownAt: 0 };
    (window as unknown as { __echoTrace: typeof trace }).__echoTrace = trace;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (target.getAttribute("aria-label") !== "Message coordinator") return;
      trace.enterAt = performance.now();
    }, true);
    const observer = new MutationObserver(() => {
      const node = document.querySelector('[data-user-echo="pending"]');
      if (!trace.shownAt && node?.textContent?.includes("OPTIMISTIC-9417")) {
        trace.shownAt = performance.now();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  await composer.click();
  await composer.fill(message);
  await page.keyboard.press("Enter");
  const pending = page.locator('[data-user-echo="pending"]');
  await expect(pending).toContainText(message);
  await expect(composer).toHaveValue("");
  const timing = await page.evaluate(() => (
    window as unknown as { __echoTrace: { enterAt: number; shownAt: number } }
  ).__echoTrace);
  expect(timing.enterAt).toBeGreaterThan(0);
  expect(timing.shownAt).toBeGreaterThan(0);
  expect(timing.shownAt - timing.enterAt).toBeLessThan(100);
  // The fake harness may already have accepted the send by this point.
  // Timing above verifies the pending state without requiring it to persist.
  const elapsed = timing.shownAt - timing.enterAt;
  console.log(`coordinator optimistic echo visible in ${elapsed.toFixed(1)}ms`);
  await capture("coordinator-optimistic-pending.png", "Coordinator user message");
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);

  await persistSessionFixture(page, {
    sessionId: "normal-echo-chat",
    title: "Normal echo chat",
    agentId: "codex-acp",
    cwd: "",
    acpSessionId: "",
    events: [
      { type: "user_prompt", data: { text: message } },
      {
        type: "agent_message_chunk",
        data: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Same transcript chrome." },
        },
      },
    ],
  });
  await page.reload();
  await page.getByRole("button", { name: "Normal echo chat", exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByText("Same transcript chrome.", { exact: true })).toBeVisible();
  await expect(page.locator('[data-chat-surface="main"]')).toBeVisible();
  await capture("normal-chat-message.png", "Normal chat uses the same transcript surface");
});
