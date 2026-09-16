import { createServer, type ServerResponse } from "node:http";
import { expect, test } from "./fixtures";
import { closeApp, launchAppWithHome } from "./helpers";

test("cloud chat survives complete desktop exit and restores without resending input", async ({ app, page, home }) => {
  const events: Array<Record<string, unknown>> = [];
  const streams = new Set<ServerResponse>();
  const mutations: string[] = [];
  let creates = 0;
  let status = "idle";
  let title = "Run cloud test";
  let relaunched: Awaited<ReturnType<typeof launchAppWithHome>> | undefined;
  const emit = (event: Record<string, unknown>) => {
    const row = { ...event, id: event.id ?? `event-${events.length + 1}`, seq: events.length + 1, processed_at: new Date().toISOString() };
    events.push(row);
    for (const stream of streams) stream.write(`event: ${row.type}\nid: ${row.seq}\ndata: ${JSON.stringify(row)}\n\n`);
  };
  const session = () => ({ id: "cloud-session", title, status, agent: { id: "cloud-agent", name: "Cloud helper" }, environment_id: "cloud-env", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), metadata: {} });
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (req.method !== "GET") mutations.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/cli/login") {
      const callback = new URL(url.searchParams.get("callback")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("user", "user");
      callback.searchParams.set("tokens", Buffer.from(JSON.stringify([{ tenant_id: "team", tenant_name: "Team", role: "owner", token: "secret", key_id: "key" }])).toString("base64"));
      res.writeHead(302, { location: callback.href }).end(); return;
    }
    if (url.pathname.endsWith("/events/stream")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" }); res.write(": connected\n\n");
      streams.add(res); req.on("close", () => streams.delete(res)); return;
    }
    res.setHeader("content-type", "application/json");
    const reply = (value: unknown) => res.end(JSON.stringify(value));
    if (url.pathname === "/v1/oma/me") return reply({ user: { id: "user", email: "cloud@example.com", name: "Cloud User" }, tenant: { id: "team" }, tenants: [{ id: "team", name: "Team", role: "owner" }] });
    if (url.pathname === "/v1/environments") return reply({ data: [{ id: "cloud-env", name: "Cloud project", config: { type: "cloud" } }] });
    if (url.pathname === "/v1/agents") return reply({ data: [{ id: "cloud-agent", name: "Cloud helper" }] });
    if (url.pathname === "/v1/oma/runtimes") return reply({ runtimes: [] });
    if (url.pathname === "/v1/sessions") { if (req.method === "POST") { creates++; return reply(session()); } return reply({ data: creates ? [session()] : [] }); }
    if (url.pathname === "/v1/sessions/cloud-session") {
      if (req.method === "POST") {
        let body = ""; req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => { const patch = JSON.parse(body); expect(Object.keys(patch)).toEqual(["title"]); title = patch.title; reply(session()); });
        return;
      }
      return reply(session());
    }
    if (url.pathname.endsWith("/outputs")) return reply({ data: [{ filename: "result.txt", size_bytes: 21, media_type: "text/plain" }] });
    if (url.pathname.endsWith("/outputs/result.txt")) { res.setHeader("content-type", "text/plain"); res.end("Remote project output"); return; }
    if (url.pathname.endsWith("/events")) {
      if (req.method === "GET") return reply({ data: events.filter((e) => Number(e.seq) > Number(url.searchParams.get("after_seq") ?? 0)).map((e) => ({ seq: e.seq, type: e.type, ts: Date.now(), data: e })), has_more: false });
      let body = ""; req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const [event] = JSON.parse(body).events; emit(event);
        status = "running"; emit({ type: "session.status_running" });
        if (event.type === "user.message" && event.content?.[0]?.text === "Continue after restart") {
          emit({ type: "agent.message", message_id: "after-restart", content: [{ type: "text", text: "Continued the same cloud task." }] });
          status = "idle"; emit({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
        } else if (event.type === "user.message") {
          emit({ type: "agent.tool_use", id: "cloud-tool", name: "bash", input: { command: "pwd" }, evaluated_permission: "ask" });
          status = "idle"; emit({ type: "session.status_idle", stop_reason: { type: "requires_action", action_type: "tool_confirmation", event_ids: ["cloud-tool"] } });
        } else if (event.type === "user.tool_confirmation") {
          expect(event).toMatchObject({ tool_use_id: "cloud-tool", result: "allow" });
          emit({ type: "agent.tool_result", tool_use_id: "cloud-tool", content: [{ type: "text", text: "/remote/project" }] });
          emit({ type: "agent.custom_tool_use", id: "question", name: "Choose a branch", input: { question: "Which branch should I use?" } });
          status = "idle"; emit({ type: "session.status_idle", stop_reason: { type: "requires_action", action_type: "custom_tool_result", event_ids: ["question"] } });
        } else {
          expect(event).toMatchObject({ type: "user.custom_tool_result", custom_tool_use_id: "question", content: [{ type: "text", text: "main" }] });
          emit({ type: "agent.message", message_id: "answer", content: [{ type: "text", text: "Executed in the cloud project." }] });
          status = "idle"; emit({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
        }
        res.writeHead(202).end();
      }); return;
    }
    reply({ data: [], has_more: false });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await app.evaluate(({ BrowserWindow, shell }) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.setBackgroundThrottling(false);
      shell.openExternal = async (url: string) => { await fetch(url); };
    });
    await page.evaluate(() => window.backchat.settingsPatch({ agents: [] }));
    await page.locator('[data-session-runtime-location="true"]').first().click();
    await page.getByRole("menuitem", { name: "Sign in to OpenMA", exact: true }).click();
    await page.getByLabel("OpenMA server").fill(`http://127.0.0.1:${port}`);
    await page.getByRole("button", { name: "Sign in to OpenMA", exact: true }).click();
    await expect(page.getByText("cloud@example.com", { exact: true })).toBeVisible();
    await page.reload();
    await page.locator('[data-session-runtime-location="true"]').first().click();
    await page.getByRole("menuitem", { name: /Cloud · Cloud project.*Cloud helper/ }).click();
    await page.locator("textarea").fill("Run cloud test");
    await page.locator("textarea").press("Enter");
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await page.getByLabel("Reply *", { exact: true }).fill("main");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByText("Executed in the cloud project.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("menuitem", { name: "result.txt", exact: true }).click();
    await expect(page.getByText("Remote project output", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(creates).toBe(1);
    expect(await page.evaluate(() => window.backchat.sessionsList())).toEqual([]);
    expect(await page.evaluate(() => window.backchat.openmaRunnerState())).toMatchObject({ enabled: false });
    const tasks = await page.evaluate(() => window.backchat.openmaTasksList());
    expect(tasks).toHaveLength(1);
    await page.reload();
    // Memory-router cold start returns home; tenant groups restore collapsed.
    await page.getByRole("button", { name: "Team", exact: true }).click();
    await page.getByText("Run cloud test", { exact: true }).first().click();
    await expect(page.getByText("Executed in the cloud project.", { exact: true })).toBeVisible();
    expect(mutations).toEqual(["POST /v1/sessions", ...Array(3).fill("POST /v1/sessions/cloud-session/events")]);
    const siblingReady = app.waitForEvent("window");
    const siblingId = await app.evaluate(({ BrowserWindow, Menu }) => {
      const previous = new Set(BrowserWindow.getAllWindows().map((window) => window.id));
      const entry = Menu.getApplicationMenu()!.items.find((item) => item.label === "File")!.submenu!.items.find((item) => item.label === "New Window")!;
      entry.click(entry, BrowserWindow.getAllWindows()[0], {} as any);
      const sibling = BrowserWindow.getAllWindows().find((window) => !previous.has(window.id))!;
      sibling.webContents.setBackgroundThrottling(false);
      return sibling.id;
    });
    const sibling = await siblingReady;
    await sibling.getByRole("button", { name: "Team", exact: true }).click();
    await sibling.getByText("Run cloud test", { exact: true }).first().click();
    await expect(sibling.getByText("Executed in the cloud project.", { exact: true })).toBeVisible();
    await expect.poll(() => streams.size).toBe(1);
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), siblingId);
    emit({ type: "agent.message", message_id: "one-window", content: [{ type: "text", text: "The first window is still connected." }] });
    await expect(page.getByText("The first window is still connected.", { exact: true })).toBeVisible();
    expect(streams.size).toBe(1);
    await page.getByTestId("new-chat-button").click();
    await expect.poll(() => streams.size).toBe(0);
    expect(mutations).toHaveLength(4);
    await page.getByText("Run cloud test", { exact: true }).first().click();
    await expect(page.getByText("The first window is still connected.", { exact: true })).toBeVisible();
    await expect.poll(() => streams.size).toBe(1);
    // A different client can leave this service task running. Exit the entire
    // Electron main process, then let the service finish while no desktop runs.
    status = "running"; emit({ type: "session.status_running" });
    await expect.poll(() => page.evaluate(async () => (await window.backchat.openmaTasksList())[0]?.status)).toBe("running");
    await page.getByText("Run cloud test", { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await page.getByRole("textbox", { name: "Rename", exact: true }).fill("Renamed cloud task");
    await page.getByRole("textbox", { name: "Rename", exact: true }).press("Enter");
    await expect.poll(() => title).toBe("Renamed cloud task");
    await page.getByText("Renamed cloud task", { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
    await page.getByText("Renamed cloud task", { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.backchat.openmaTasksList())[0])).toMatchObject({ title: "Renamed cloud task", status: "running", pinnedAt: expect.any(Number), archivedAt: expect.any(Number) });
    expect(mutations).toEqual(["POST /v1/sessions", ...Array(3).fill("POST /v1/sessions/cloud-session/events"), "POST /v1/sessions/cloud-session"]);
    await closeApp(app);
    expect(app.process().exitCode).toBe(0);
    expect(app.process().signalCode).toBeNull();
    await expect.poll(() => streams.size).toBe(0);
    expect(status).toBe("running");
    emit({ type: "agent.message", message_id: "while-closed", content: [{ type: "text", text: "Finished while Backchat was closed." }] });
    status = "idle"; emit({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
    relaunched = await launchAppWithHome(home);
    const restored = relaunched.page;
    await relaunched.app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.setBackgroundThrottling(false); });
    expect(await restored.evaluate(() => window.backchat.openmaAccountState())).toMatchObject({ status: "signed_in", activeWorkspaceId: "team" });
    expect(await restored.evaluate(async () => (await window.backchat.openmaTasksList())[0])).toMatchObject({ pinnedAt: expect.any(Number), archivedAt: expect.any(Number) });
    await expect(restored.getByText("Renamed cloud task", { exact: true })).toHaveCount(0);
    await restored.keyboard.press("Meta+k");
    await restored.getByRole("combobox").fill("Renamed cloud task");
    await restored.getByRole("option").filter({ hasText: "Renamed cloud task" }).click();
    await expect(restored.getByText("Finished while Backchat was closed.", { exact: true })).toBeVisible();
    await expect(restored.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
    expect(mutations).toHaveLength(5);
    expect(creates).toBe(1);
    await restored.getByRole("button", { name: "Files", exact: true }).click();
    await restored.getByRole("menuitem", { name: "result.txt", exact: true }).click();
    await expect(restored.getByText("Remote project output", { exact: true })).toBeVisible();
    await restored.keyboard.press("Escape");
    await restored.getByRole("link", { name: "Settings", exact: true }).click();
    await restored.getByRole("link", { name: "Archived chats", exact: true }).click();
    const archivedRow = restored.getByRole("listitem").filter({ hasText: "Renamed cloud task" });
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow.getByRole("button", { name: "彻底删除", exact: true })).toHaveCount(0);
    await archivedRow.getByRole("button", { name: "恢复", exact: true }).click();
    await expect.poll(() => restored.evaluate(async () => (await window.backchat.openmaTasksList())[0])).toMatchObject({ archivedAt: null, pinnedAt: expect.any(Number) });
    await restored.getByRole("button", { name: "Back to app", exact: true }).click();
    await restored.getByRole("button", { name: "Team", exact: true }).click();
    await restored.getByText("Renamed cloud task", { exact: true }).first().click();
    await restored.locator("textarea").fill("Continue after restart");
    await restored.locator("textarea").press("Enter");
    await expect(restored.getByText("Continued the same cloud task.", { exact: true })).toBeVisible();
    expect(mutations).toHaveLength(6);
    for (const stream of streams) stream.end();
    await expect(restored.getByText("Connection interrupted · reconnecting", { exact: true })).toBeVisible();
    expect(mutations).toHaveLength(6);
  } finally { await relaunched?.cleanup(); for (const stream of streams) stream.end(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
