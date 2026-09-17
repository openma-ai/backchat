import { execFileSync } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openmaDesktopTaskId, openmaRunnerSessionId } from "../src/main/openma-identity";
import { expect, test } from "./fixtures";

test("desktop login selects a workspace without registering the machine", async ({ app, page, home }) => {
  const hasIdleSleepAssertion = () => execFileSync('/usr/bin/pmset', ['-g', 'assertions'], { encoding: 'utf8' })
    .split('\n').some(line => line.includes(`pid ${app.process().pid}(`) && /PreventUserIdleSystemSleep|NoIdleSleepAssertion/.test(line));
  if (process.platform === 'darwin') await expect.poll(hasIdleSleepAssertion).toBe(false);
  const requests: string[] = [];
  let runnerAttached = false;
  let runnerSocket: WebSocket | undefined;
  const frames: Array<Record<string, unknown>> = [];
  const rawFrames: Array<Record<string, any>> = [];
  const delivered = new Set<string>();
  let holdRecovery = false;
  let droppedOutput = false;
  let waitingWelcome: WebSocket | undefined;
  const welcome = (socket: WebSocket) => socket.send(JSON.stringify({ type: "welcome", capabilities: ["durable_session_events_v1"] }));
  const events: Array<Record<string, any>> = [];
  const streams = new Set<ServerResponse>();
  const replies: Array<Record<string, any>> = [];
  const emit = (event: Record<string, unknown>) => {
    const row = { ...event, id: event.id ?? `event-${events.length + 1}`, seq: events.length + 1 };
    events.push(row);
    for (const stream of streams) stream.write(`event: ${row.type}\nid: ${row.seq}\ndata: ${JSON.stringify(row)}\n\n`);
  };
  const environment = { id: "project-env", name: "Project environment", type: "environment", config: { type: "self_hosted" }, archived_at: null, metadata: { custom: "preserved" } as Record<string, string> };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    requests.push(url.pathname);
    if (url.pathname === "/cli/login") {
      const callback = new URL(url.searchParams.get("callback")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("user", "user");
      callback.searchParams.set("tokens", Buffer.from(JSON.stringify([
        { tenant_id: "alpha", tenant_name: "Alpha", role: "owner", token: "alpha-secret", key_id: "a-key" },
        { tenant_id: "beta", tenant_name: "Beta", role: "member", token: "beta-secret", key_id: "b-key" },
      ])).toString("base64"));
      res.writeHead(302, { location: callback.href }).end();
    } else if (url.pathname === "/connect-runtime") {
      const callback = new URL(url.searchParams.get("cb")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("code", "runner-code");
      res.writeHead(302, { location: callback.href }).end();
    } else if (url.pathname === "/agents/runtime/exchange") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ runtime_id: "runner", token: "runner-secret", tenants: [{ id: "beta", name: "Beta", agent_api_key: "beta-secret" }] }));
    } else if (url.pathname === "/v1/oma/me") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        user: { id: "user", email: "person@example.com", name: "Person" },
        tenant: { id: req.headers["x-api-key"] === "beta-secret" ? "beta" : "alpha" },
        tenants: [{ id: "alpha", name: "Alpha", role: "owner" }, { id: "beta", name: "Beta", role: "member" }],
      }));
    } else if (url.pathname === "/v1/sessions") {
      const data = req.headers["x-active-tenant"] === "beta" && frames.some((frame) => frame.type === "session.ready" && frame.session_id === "linked-task") ? [{
        id: "linked-task", title: "Runner linked task", status: "idle", environment_id: "project-env",
        agent: { id: "bound-codex", name: "Codex on runner" }, metadata: { "backchat.runtime_id": "runner" },
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }] : [];
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ data, has_more: false }));
    } else if (url.pathname === "/v1/sessions/linked-task/events/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": connected\n\n");
      streams.add(res); req.on("close", () => streams.delete(res));
    } else if (url.pathname === "/v1/sessions/linked-task/events") {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET") res.end(JSON.stringify({ data: events.filter((event) => event.seq > Number(url.searchParams.get("after_seq") ?? 0)).map((event) => ({ seq: event.seq, type: event.type, ts: Date.now(), data: event })), has_more: false }));
      else {
        let body = ""; req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          const [event] = JSON.parse(body).events; replies.push(event); emit(event);
          if (event.type === "user.interrupt") {
            const pending = events.findLast((entry) => entry.type === "agent.custom_tool_use");
            if (pending) runnerSocket!.send(JSON.stringify({ type: "session.cancel", session_id: "linked-task", tenant_id: "beta", turn_id: pending.input._openma.turn_id }));
            res.writeHead(202).end(); return;
          }
          const request = events.find((entry) => entry.id === event.custom_tool_use_id);
          if (request) runnerSocket!.send(JSON.stringify({ type: "session.response", session_id: "linked-task", tenant_id: "beta", turn_id: request.input._openma.turn_id, request_id: request.id, response: JSON.parse(event.content[0].text) }));
          res.writeHead(202).end();
        });
      }
    } else if (url.pathname.startsWith("/v1/sessions/")) {
      res.setHeader("Content-Type", "application/json");
      const id = url.pathname.split("/").at(-1);
      res.end(JSON.stringify({ id, title: "Runner linked task", status: "idle", environment_id: id === "unlinked-task" ? "unknown-env" : "project-env" }));
    } else if (url.pathname === "/v1/environments") {
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ data: [environment], has_more: false }));
    } else if (url.pathname === "/v1/environments/project-env") {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST") {
        let body = ""; req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => { environment.metadata = JSON.parse(body).metadata; res.end(JSON.stringify(environment)); });
      } else res.end(JSON.stringify(environment));
    } else { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ runtimes: [], data: [], has_more: false })); }
  });
  const ws = new WebSocketServer({ server });
  ws.on("connection", (socket) => {
    runnerSocket = socket;
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)); rawFrames.push(frame);
      const deliveryKey = frame.delivery ? `${frame.delivery.stream_id}/${frame.delivery.seq}` : null;
      if (deliveryKey) {
        if (frame.turn_id === "outage-turn" && !droppedOutput) {
          droppedOutput = true; holdRecovery = true;
          // The service accepted the first frame, but its receipt was lost.
          socket.terminate();
        } else socket.send(JSON.stringify({ type: "session.ack", session_id: frame.session_id, tenant_id: frame.tenant_id, delivery: frame.delivery }));
        if (delivered.has(deliveryKey)) return;
        delivered.add(deliveryKey);
      }
      frames.push(frame);
      if (frame.type === "hello") { runnerAttached = true; if (holdRecovery) waitingWelcome = socket; else welcome(socket); }
      // Service boundary fixture; the production proxy's callback translation
      // and continuation are covered in OpenMA's acp-proxy-actions test.
      if (frame.type === "session.event" && frame.event?.type === "client.request") {
        emit({ type: "agent.custom_tool_use", id: frame.event.request_id, name: "Write approved artifact", input: { _openma: { type: "runtime_action", method: frame.event.method, turn_id: frame.turn_id, params: frame.event.params } } });
        emit({ type: "session.status_idle", stop_reason: { type: "requires_action", action_type: "custom_tool_result", event_ids: [frame.event.request_id] } });
      }
      if (frame.type === "session.complete" && frame.turn_id === "cancel-approval-turn") emit({ type: "session.status_idle", stop_reason: { type: "end_turn" } });
    });
    socket.on("close", () => { runnerAttached = false; });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  try {
    // Hidden Electron windows otherwise throttle the animation frames that
    // Playwright uses for input stability and scrolling checks.
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false); });
    // The browser boundary is replaced; the real main-process login callback,
    // HTTP verification, persistence, IPC, and renderer all run unchanged.
    await app.evaluate(({ shell }) => { shell.openExternal = async (url: string) => { await fetch(url); }; });
    await page.locator('[data-session-runtime-location="true"]').first().click();
    await page.getByRole("menuitem", { name: "Sign in to OpenMA" }).click();
    await expect(page.getByRole("heading", { name: "OpenMA" })).toBeVisible();
    await page.getByLabel("OpenMA server").fill(`http://127.0.0.1:${address.port}`);
    await page.getByRole("button", { name: "Sign in to OpenMA", exact: true }).click();
    await expect(page.getByText("person@example.com", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Workspace")).toHaveValue("");
    await page.getByLabel("Workspace").selectOption("beta");
    await expect.poll(() => page.evaluate(() => window.backchat.openmaAccountState())).toMatchObject({ activeWorkspaceId: "beta", status: "signed_in" });
    expect(requests.some((path) => path.includes("exchange") || path.includes("connect-runtime"))).toBe(false);
    expect(await page.locator("body").innerText()).not.toContain("beta-secret");
    await page.getByRole("checkbox", { name: "Connect this machine as a runner" }).check();
    await expect.poll(() => page.evaluate(() => window.backchat.openmaRunnerState()), { timeout: 20_000 }).toMatchObject({ enabled: true, status: "online" });
    expect(runnerAttached).toBe(true);
    if (process.platform === "darwin") await expect.poll(hasIdleSleepAssertion).toBe(true);
    const folder = join(home, "sample-project"); await mkdir(folder);
    await page.evaluate(async (cwd) => { await window.backchat.projectSave({ project_id: "project", name: "Sample project", primary_folder: cwd, source_folders: [cwd] }); }, folder);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.backchat.openmaAccountState())).toMatchObject({ activeWorkspaceId: "beta" });
    await page.locator('[data-session-runtime-location="true"]').first().click();
    await page.getByRole("menuitem", { name: "OpenMA account", exact: true }).click();
    await page.getByLabel("Backchat project", { exact: true }).selectOption("project");
    await page.getByLabel("OpenMA environment", { exact: true }).selectOption("project-env");
    await page.getByRole("button", { name: "Link environment", exact: true }).click();
    await expect(page.getByText("Sample project → Project environment", { exact: true })).toBeVisible();
    expect(environment.metadata).toEqual({ custom: "preserved", "backchat.runtime_id": "runner", "backchat.project_id": "project", "backchat.project_name": "Sample project" });
    expect(JSON.stringify(environment.metadata)).not.toContain(folder);
    await page.evaluate(async ({ node, agent }) => {
      await window.backchat.settingsPatch({ agents: [{ id: "codex-acp", enabled: true, command_override: node, args_override: [agent], env: [] }] });
      (window as any).runnerTestEvents = [];
      window.backchat.onSessionEvent((event) => (window as any).runnerTestEvents.push(event));
    }, { node: process.execPath, agent: resolve("e2e/fixtures/fake-acp-agent.mjs") });
    runnerSocket!.send(JSON.stringify({ type: "session.start", session_id: "unlinked-task", tenant_id: "beta", agent_id: "codex-acp" }));
    await expect.poll(() => frames.find((frame) => frame.type === "session.error" && frame.session_id === "unlinked-task")).toMatchObject({ message: expect.stringMatching(/linked project/i) });
    runnerSocket!.send(JSON.stringify({ type: "session.start", session_id: "linked-task", tenant_id: "beta", agent_id: "codex-acp", cwd: home }));
    await expect.poll(() => frames.find((frame) => frame.type === "session.ready" && frame.session_id === "linked-task"), { timeout: 20_000 }).toBeTruthy();
    const scope = { baseUrl: `http://127.0.0.1:${address.port}`, userId: "user", workspaceId: "beta" };
    const localId = openmaRunnerSessionId(scope, "linked-task");
    const taskId = openmaDesktopTaskId(scope, "linked-task");
    const db = new DatabaseSync(join(home, "sessions.db"), { readOnly: true });
    try {
      expect(db.prepare("SELECT id, cwd, project_id FROM sessions WHERE id = ?").get(localId)).toMatchObject({ id: localId, cwd: folder, project_id: "project" });
      expect(db.prepare("SELECT id FROM sessions WHERE id = ?").get("linked-task")).toBeUndefined();
    } finally { db.close(); }
    expect(await page.evaluate(async (id) => (await window.backchat.sessionsList()).some((session) => session.id === id), localId)).toBe(false);
    expect(await page.evaluate(() => (window as any).runnerTestEvents)).toEqual([]);
    const directError = await page.evaluate(async (id) => {
      try { await window.backchat.sessionPrompt({ session_id: id, turn_id: "bypass", text: "bypass" }); return null; }
      catch (error) { return String(error); }
    }, localId);
    expect(directError).toMatch(/associated OpenMA task/);
    runnerSocket!.send(JSON.stringify({ type: "session.prompt", session_id: "linked-task", tenant_id: "beta", turn_id: "turn", text: "write-workspace-artifact-e2e" }));
    await expect.poll(() => frames.find((frame) => frame.type === "session.complete" && frame.session_id === "linked-task" && frame.turn_id === "turn")).toBeTruthy();
    expect(await readFile(join(folder, "runner-output.txt"), "utf8")).toBe("Created in the linked project");
    expect((await page.evaluate(() => window.backchat.openmaTasksRefresh())).map((task) => task.id)).toEqual([taskId]);
    await page.reload();
    await expect(page.getByText("Runner linked task", { exact: true })).toHaveCount(1);
    expect(await page.evaluate(async (id) => (await window.backchat.sessionsList()).some((session) => session.id === id), localId)).toBe(false);
    emit({ type: "user.message", content: [{ type: "text", text: "Approve a project artifact" }] });
    runnerSocket!.send(JSON.stringify({ type: "session.prompt", session_id: "linked-task", tenant_id: "beta", turn_id: "approval-turn", text: "approve-workspace-artifact-e2e" }));
    await expect.poll(() => events.some((event) => event.type === "agent.custom_tool_use")).toBe(true);
    expect(await page.evaluate(() => window.backchat.brokerPendingAsks())).toEqual([]);
    await expect(readFile(join(folder, "approved-output.txt"), "utf8")).rejects.toThrow();
    if (await page.getByRole("button", { name: "Beta", exact: true }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "Beta", exact: true }).click();
    await page.getByText("Runner linked task", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Write once", exact: true })).toBeVisible();
    await page.getByTestId("new-chat-button").click();
    await expect.poll(() => streams.size).toBe(0);
    if (await page.getByRole("button", { name: "Beta", exact: true }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "Beta", exact: true }).click();
    await page.getByText("Runner linked task", { exact: true }).click();
    await page.getByRole("button", { name: "Write once", exact: true }).click();
    await expect.poll(async () => readFile(join(folder, "approved-output.txt"), "utf8")).toBe("Approved in the linked project");
    await expect.poll(() => frames.filter((frame) => frame.type === "session.complete" && frame.turn_id === "approval-turn").length).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ type: "user.custom_tool_result", content: [{ type: "text", text: JSON.stringify({ outcome: { outcome: "selected", optionId: "write:once" } }) }] });
    emit({ type: "user.message", content: [{ type: "text", text: "Stop while waiting for permission" }] });
    runnerSocket!.send(JSON.stringify({ type: "session.prompt", session_id: "linked-task", tenant_id: "beta", turn_id: "cancel-approval-turn", text: "approve-workspace-artifact-e2e" }));
    await expect(page.getByRole("button", { name: "Write once", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Task actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Stop", exact: true }).click();
    await expect.poll(() => frames.find((frame) => frame.type === "session.event" && frame.turn_id === "cancel-approval-turn" && (frame.event as any)?.type === "promptComplete")).toMatchObject({ event: { response: { stopReason: "cancelled" } } });
    await expect(page.getByRole("button", { name: "Write once", exact: true })).toHaveCount(0);
    expect(replies.filter((event) => event.type === "user.interrupt")).toHaveLength(1);
    expect(replies.filter((event) => event.type === "user.custom_tool_result")).toHaveLength(1);
    runnerSocket!.send(JSON.stringify({ type: "session.prompt", session_id: "linked-task", tenant_id: "beta", turn_id: "outage-turn", text: "recover-offline-output-e2e" }));
    await expect.poll(() => droppedOutput).toBe(true);
    await expect.poll(async () => readFile(join(folder, "offline-output.txt"), "utf8").catch((error) => {
      if (error.code === "ENOENT") return null; throw error;
    })).toBe("Completed while disconnected");
    const pendingOutput = () => {
      const db = new DatabaseSync(join(home, "backchat", "openma", "runner-outbox.db"), { readOnly: true });
      try { return (db.prepare("SELECT body FROM frames WHERE json_extract(body, '$.turn_id') = 'outage-turn' ORDER BY seq").all() as Array<{ body: string }>).map((row) => JSON.parse(row.body)); }
      finally { db.close(); }
    };
    await expect.poll(() => pendingOutput().map((frame) => frame.type)).toEqual(["session.event", "session.event", "session.event", "session.complete"]);
    holdRecovery = false;
    if (waitingWelcome) welcome(waitingWelcome);
    await expect.poll(() => frames.filter((frame) => frame.turn_id === "outage-turn" && frame.type === "session.complete").length).toBe(1);
    await expect.poll(() => pendingOutput().length).toBe(0);
    const recovered = frames.filter((frame) => frame.turn_id === "outage-turn");
    expect(recovered.slice(0, 2).map((frame) => (frame.event as any).update.content.text)).toEqual(["Before disconnect. ", "After disconnect."]);
    expect(recovered.at(-2)).toMatchObject({ event: { type: "promptComplete", response: { stopReason: "end_turn" } } });
    const first = rawFrames.find((frame) => frame.turn_id === "outage-turn")!;
    expect(rawFrames.filter((frame) => frame.delivery?.stream_id === first.delivery.stream_id && frame.delivery.seq === first.delivery.seq)).toHaveLength(2);
    expect(await readFile(join(folder, "offline-prompt-count.txt"), "utf8")).toBe("started\n");
    // Closing the last window detaches the UI while the existing execution
    // host continues. Reopening must reconnect to that same runner.
    runnerSocket!.send(JSON.stringify({ type: "session.prompt", session_id: "linked-task", tenant_id: "beta", turn_id: "background-turn", text: "recover-offline-output-e2e" }));
    const windowClosed = page.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.close(); });
    await windowClosed;
    await expect.poll(() => frames.filter((frame) => frame.type === "session.complete" && frame.turn_id === "background-turn").length).toBe(1);
    expect(app.process().exitCode).toBeNull();
    expect(runnerAttached).toBe(true);
    if (process.platform === "darwin") await expect.poll(hasIdleSleepAssertion).toBe(true);
    expect(await readFile(join(folder, "offline-prompt-count.txt"), "utf8")).toBe("started\nstarted\n");
    const greetingsBeforeWake = frames.filter(frame => frame.type === "hello").length;
    await app.evaluate(({ powerMonitor }) => { powerMonitor.emit("resume"); });
    await expect.poll(() => frames.filter(frame => frame.type === "hello").length).toBe(greetingsBeforeWake + 1);
    expect(await readFile(join(folder, "offline-prompt-count.txt"), "utf8")).toBe("started\nstarted\n");
    const reopened = app.waitForEvent("window");
    await app.evaluate(({ Menu }) => {
      const entry = Menu.getApplicationMenu()!.items.find((item) => item.label === "File")!.submenu!.items.find((item) => item.label === "New Window")!;
      entry.click(entry, undefined, {} as any);
    });
    page = await reopened;
    await expect.poll(() => page.evaluate(() => window.backchat.openmaRunnerState())).toMatchObject({ enabled: true, status: "online" });
    await page.getByTestId("new-chat-button").click();
    await page.locator('[data-session-runtime-location="true"]').first().click();
    await page.getByRole("menuitem", { name: "OpenMA account", exact: true }).click();
    await page.getByRole("button", { name: "Unlink", exact: true }).click();
    await expect(page.getByText("Sample project → Project environment", { exact: true })).toHaveCount(0);
    expect(environment.metadata).toEqual({ custom: "preserved" });
    await page.evaluate(() => window.backchat.openmaLogout());
    await expect.poll(() => page.evaluate(() => window.backchat.openmaAccountState())).toMatchObject({ status: "signed_out" });
    await expect.poll(() => runnerAttached).toBe(false);
    if (process.platform === "darwin") await expect.poll(hasIdleSleepAssertion).toBe(false);
    await expect(page.getByText("Runner linked task", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(async (id) => (await window.backchat.sessionsList()).some((session) => session.id === id), localId)).toBe(false);
  } finally { ws.close(); for (const socket of ws.clients) socket.terminate(); server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); }
});
