import { expect, test } from "./fixtures";
import { persistSessionFixture } from "./helpers";

test("coordinator chat shows the user message before the host accepts it", async ({ page, capture, app }) => {
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
  await project.locator("..").getByRole("link").click();
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
  // The user message is on screen before the host accepts it. A quick host
  // can already have replaced the pending bubble by the time this lands, and
  // then the accepted turn carries the same text — either way the message is
  // visible exactly once.
  await expect.poll(async () => {
    if ((await pending.count()) > 0) {
      return (await pending.allTextContents()).join(" ").includes(message);
    }
    return (await page.getByText(message, { exact: true }).count()) === 1;
  }).toBe(true);
  await expect(composer).toHaveValue("");
  const timing = await page.evaluate(() => (
    window as unknown as { __echoTrace: { enterAt: number; shownAt: number } }
  ).__echoTrace);
  expect(timing.enterAt).toBeGreaterThan(0);
  expect(timing.shownAt).toBeGreaterThan(0);
  // The echo is optimistic: it shows long before the host answers. A loaded CI
  // machine needs headroom, but 500ms still asserts a fast echo.
  expect(timing.shownAt - timing.enterAt).toBeLessThan(500);
  // The pending echo disappears the moment the host accepts the turn, so what
  // follows has to hold for both outcomes: it must not fail only because the
  // host was quick.
  await expect.poll(async () => {
    if ((await pending.count()) === 0) {
      // Accepted: the send is not stuck in the pending state.
      return (await page.locator('[data-user-echo-status="pending"]').count()) === 0;
    }
    // Still pending: the turn has not started running yet.
    const running = await page.locator('[data-session-process-state="running"]').count();
    const pendingText = (await pending.allTextContents()).join(" ");
    return running === 0 && !pendingText.includes("Working for");
  }).toBe(true);
  const elapsed = timing.shownAt - timing.enterAt;
  console.log(`coordinator optimistic echo visible in ${elapsed.toFixed(1)}ms`);
  await capture("coordinator-optimistic-pending.png", "User message is visible while the send is still pending");
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
