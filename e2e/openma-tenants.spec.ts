import { createServer, type ServerResponse } from "node:http";
import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("tenant groups start collapsed above local and route new and continued sessions to their owner", async ({ app, page }) => {
  const calls: string[] = [];
  const streams = new Set<ServerResponse>();
  const session = (tenant: string, id = "shared-id") => ({ id, title: `${tenant} task`, status: "idle", agent: { id: "agent", name: "Helper" }, environment_id: "env" });
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/cli/login") {
      const callback = new URL(url.searchParams.get("callback")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("user", "user");
      callback.searchParams.set("tokens", Buffer.from(JSON.stringify(["Alpha", "Beta"].map((id) => ({ tenant_id: id, tenant_name: id, role: "owner", token: `key-${id}`, key_id: id })))).toString("base64"));
      res.writeHead(302, { location: callback.href }).end(); return;
    }
    const tenant = String(req.headers["x-api-key"]).replace("key-", "");
    if (url.pathname.endsWith("/events/stream")) {
      res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": ready\n\n");
      streams.add(res); req.on("close", () => streams.delete(res)); return;
    }
    const reply = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    if (url.pathname === "/v1/oma/me") return reply({ user: { id: "user", email: "tenants@example.com", name: "User" }, tenant: { id: tenant }, tenants: ["Alpha", "Beta"].map((id) => ({ id, name: id, role: "owner" })) });
    expect(req.headers["x-active-tenant"]).toBe(tenant);
    calls.push(`${tenant}:${req.method}:${url.pathname}`);
    if (url.pathname === "/v1/environments") return reply({ data: [{ id: "env", name: "Project", config: { type: "cloud" } }] });
    if (url.pathname === "/v1/agents") return reply({ data: [{ id: "agent", name: "Helper" }] });
    if (url.pathname === "/v1/oma/runtimes") return reply({ runtimes: [] });
    if (url.pathname === "/v1/sessions") return reply(req.method === "POST" ? session(tenant, "new-id") : { data: [session(tenant)] });
    if (url.pathname.endsWith("/events")) {
      if (req.method === "POST") { res.writeHead(202).end(); return; }
      return reply({ data: [], has_more: false });
    }
    if (url.pathname.startsWith("/v1/sessions/")) return reply(session(tenant));
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await app.evaluate(({ shell }) => { shell.openExternal = async (url: string) => { await fetch(url); }; });
    await page.evaluate(async (baseUrl) => { await window.backchat.settingsPatch({ agents: [] }); await window.backchat.openmaLogin(baseUrl); }, `http://127.0.0.1:${port}`);
    const nav = page.locator('[data-sidebar-scroll-area] nav');
    const alpha = nav.getByRole("button", { name: "Alpha", exact: true });
    const beta = nav.getByRole("button", { name: "Beta", exact: true });
    await expect(alpha).toHaveAttribute("aria-expanded", "false");
    await expect(beta).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("button", { name: "Local", exact: true })).toHaveAttribute("aria-expanded", "true");
    expect(await nav.locator(':scope > section > div > button[aria-expanded]').evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label")).slice(0, 3))).toEqual(["Alpha", "Beta", "Local"]);
    await mkdir("artifacts/tenant-sidebar", { recursive: true });
    await page.screenshot({ path: "artifacts/tenant-sidebar/collapsed.png" });
    await beta.click();
    await nav.getByText("Beta task", { exact: true }).click();
    await page.locator("textarea").fill("Continue B"); await page.locator("textarea").press("Enter");
    await expect.poll(() => calls.filter((c) => c === "Beta:POST:/v1/sessions/shared-id/events").length).toBe(1);
    await page.evaluate(() => window.backchat.openmaSelectWorkspace("Beta"));
    await alpha.click();
    await nav.getByRole("button", { name: "New chat in Alpha", exact: true }).click();
    await page.getByRole("menuitem", { name: /Cloud · Project.*Helper/ }).click();
    await page.locator("textarea").fill("New A"); await page.locator("textarea").press("Enter");
    await expect.poll(() => calls.filter((c) => c === "Alpha:POST:/v1/sessions/new-id/events").length).toBe(1);
    expect((await page.evaluate(() => window.backchat.openmaAccountState())).activeWorkspaceId).toBe("Beta");
    await page.screenshot({ path: "artifacts/tenant-sidebar/expanded.png" });
    await page.evaluate(() => window.backchat.openmaLogout());
    await expect(alpha).toHaveCount(0); await expect(beta).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Local", exact: true })).toBeVisible();
  } finally {
    for (const stream of streams) stream.end(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
