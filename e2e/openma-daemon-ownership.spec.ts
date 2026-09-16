import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { expect, test } from "@playwright/test";
import { launchApp, launchAppWithHome } from "./helpers";

test("external daemon stays usable after Backchat quits, restores, disconnects and signs out", async () => {
  const runtime = { id: "runtime", machine_id: "machine", hostname: "Existing runner", status: "online", version: "0.6.0", agents: [{ id: "codex-acp", binary: "codex-acp" }] };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const json = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    if (url.pathname === "/cli/login") {
      const callback = new URL(url.searchParams.get("callback")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("user", "user");
      callback.searchParams.set("tokens", Buffer.from(JSON.stringify([{ tenant_id: "team", tenant_name: "Team", role: "owner", token: "user-key", key_id: "key" }])).toString("base64"));
      res.writeHead(302, { location: callback.href }).end(); return;
    }
    if (url.pathname === "/v1/oma/me") return json({ user: { id: "user", email: "user@example.com", name: "User" }, tenant: { id: "team" }, tenants: [{ id: "team", name: "Team", role: "owner" }] });
    if (url.pathname === "/v1/oma/runtimes") return json({ runtimes: [runtime] });
    if (url.pathname === "/agents/runtime/me") return json({ runtime: { ...runtime, last_heartbeat: Math.floor(Date.now() / 1000) }, tenants: [{ id: "team" }] });
    if (url.pathname === "/v1/agents") return json({ data: [{ id: "agent", name: "Codex on existing runner", _oma: { runtime_binding: { runtime_id: "runtime", acp_agent_id: "codex-acp" } } }], has_more: false });
    if (url.pathname === "/v1/environments") return json({ data: [{ id: "env", name: "Daemon project", config: { type: "self_hosted" }, metadata: { "backchat.runtime_id": "runtime" }, archived_at: null }], has_more: false });
    if (url.pathname.includes("exchange") || url.pathname.includes("refresh")) { res.writeHead(500).end(); return; }
    json({ data: [], has_more: false });
  });
  const sockets = new WebSocketServer({ server });
  let attachments = 0;
  sockets.on("connection", (socket) => {
    attachments++;
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.on("message", (data) => { if (String(data) === "ping") socket.send("pong"); });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const external = new WebSocket(baseUrl.replace("http:", "ws:") + "/agents/runtime/_attach");
  await once(external, "open");
  let launched = await launchApp();
  const home = launched.home;
  const credentials = JSON.stringify({ v: 2, serverUrl: baseUrl, runtimeId: "runtime", machineId: "machine", token: "machine-key", tenants: [{ id: "team", name: "Team", agentApiKey: "tenant-key" }] });
  const stillUsable = async () => {
    expect(external.readyState).toBe(WebSocket.OPEN);
    const reply = once(external, "message"); external.send("ping");
    expect(String((await reply)[0])).toBe("pong");
    expect(attachments).toBe(1);
  };
  try {
    await mkdir(join(home, "bridge"), { recursive: true });
    await writeFile(join(home, "bridge", "credentials.json"), credentials, { mode: 0o600 });
    await writeFile(join(home, "bridge", "daemon.pid"), String(process.pid), { mode: 0o600 });
    await launched.app.evaluate(({ shell }) => { shell.openExternal = async (url) => { await fetch(url); }; });
    await launched.page.evaluate(async (url) => { await window.backchat.openmaLogin(url); await window.backchat.openmaRunnerEnable(); }, baseUrl);
    await expect.poll(() => launched.page.evaluate(() => window.backchat.openmaRunnerState())).toMatchObject({ hosting: "external", status: "online", enabled: true });
    await launched.app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false); });
    await launched.page.locator('[data-session-runtime-location="true"]').first().click();
    await expect(launched.page.getByRole("menuitem", { name: /Existing runner.*Daemon project/ })).toBeVisible();
    await launched.page.getByRole("menuitem", { name: "OpenMA account", exact: true }).click();
    await expect(launched.page.getByText("Managed independently. Disconnecting or quitting Backchat leaves this runner running.", { exact: true })).toBeVisible();
    await launched.app.close();
    await stillUsable();
    launched = await launchAppWithHome(home);
    await expect.poll(() => launched.page.evaluate(() => window.backchat.openmaRunnerState())).toMatchObject({ hosting: "external", status: "online", enabled: true });
    await launched.page.evaluate(() => window.backchat.openmaRunnerDisable());
    await stillUsable();
    await launched.page.evaluate(async () => { await window.backchat.openmaRunnerEnable(); await window.backchat.openmaLogout(); });
    await expect.poll(() => launched.page.evaluate(() => window.backchat.openmaRunnerState())).toMatchObject({ hosting: null, enabled: false });
    await stillUsable();
    expect(await readFile(join(home, "bridge", "credentials.json"), "utf8")).toBe(credentials);
  } finally {
    await launched.cleanup(); external.terminate();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
