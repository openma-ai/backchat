import { createServer, type ServerResponse } from "node:http";
import { expect, test } from "./fixtures";
import { closeApp, launchAppWithHome } from "./helpers";

for (const provider of ["openma", "claude-managed", "openai-agents"] as const) {
  test(`${provider}: key and base URL create a tenant, chat and restore without resending`, async ({ app, page, home }) => {
    const streams = new Set<ServerResponse>();
    const events: Array<Record<string, unknown>> = [];
    const items: Array<Record<string, unknown>> = [];
    const turns: Array<Record<string, unknown>> = [];
    const unexpected: string[] = [];
    const calls: string[] = [];
    let creates = 0, sends = 0;
    let metadata: Record<string, string> = {};
    let relaunched: Awaited<ReturnType<typeof launchAppWithHome>> | undefined;
    const openai = provider === "openai-agents";
    const native = provider === "openma";
    const prefix = openai ? "/v1/agents" : "/v1";
    const title = `External ${native ? "OpenMA" : openai ? "OpenAI" : "Claude"}`;
    const session = () => openai ? { id: "s", object: "agent.session", agent: { id: "a", name: "Helper", model: "model" }, environment: { type: "none" }, status: "idle", metadata, created_at: 1000, last_active_at: 1001, required_actions: [], error: null }
      : { id: "s", agent: { id: "a", name: "Helper" }, environment_id: "env", title: "Remote test", status: "idle", created_at: new Date(1000000).toISOString(), updated_at: new Date(1001000).toISOString() };
    const emit = (event: Record<string, unknown>) => {
      for (const stream of streams) stream.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, "http://localhost"); const path = url.pathname;
      calls.push(`${req.method} ${path}`);
      if ((openai ? req.headers.authorization : req.headers["x-api-key"]) !== (openai ? "Bearer fake-secret" : "fake-secret")) { unexpected.push("authentication"); res.writeHead(401).end(); return; }
      const streamPath = `${prefix}/sessions/s/${openai ? "events" : "events/stream"}`;
      if (req.method === "GET" && path === streamPath) {
        res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": connected\n\n"); streams.add(res); req.on("close", () => streams.delete(res)); return;
      }
      const reply = (value: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
      const list = (data: unknown[]) => reply({ data, has_more: false, first_id: null, last_id: null });
      if (native && path === "/v1/oma/me") return reply({ user: { id: "user", email: "key@test", name: "Key User" }, tenant: { id: "team", name: "Team" }, tenants: [{ id: "team", name: "Team", role: "owner" }] });
      if (native && path === "/v1/oma/runtimes") return reply({ runtimes: [] });
      if (path === "/v1/agents") return list([{ id: "a", name: "Helper" }]);
      if (path === "/v1/environments") return list([{ id: "env", name: "Cloud", config: { type: "cloud" } }]);
      if (path === `${prefix}/sessions`) {
        if (req.method === "POST") {
          let body = ""; for await (const chunk of req) body += chunk;
          metadata = JSON.parse(body).metadata ?? {}; creates++; return reply(session());
        }
        return list(creates ? [session()] : []);
      }
      if (path === `${prefix}/sessions/s`) return reply(session());
      if (path.endsWith("/items")) return list(items);
      if (path.endsWith("/turns")) return list(turns);
      if (path.endsWith("/resources") || path.endsWith("/artifacts")) return list([]);
      if (path === `${prefix}/sessions/s/events`) {
        if (req.method === "GET") return list(events);
        let body = ""; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body).events[0]; sends++;
        if (openai) {
          if (input.type !== "agent.session.input.message") unexpected.push(input.type);
          const turn = { id: `t${sends}`, session_id: "s", status: "completed", created_at: 1000 + sends, completed_at: 1001 + sends, error: null, subagent_id: null };
          const user = { id: `u${sends}`, type: "message", role: "user", content: input.input[0].content, turn_id: turn.id, status: "completed" };
          const answer = { id: `a${sends}`, type: "message", role: "assistant", content: [{ type: "output_text", text: `Remote answer ${sends}` }], turn_id: turn.id, status: "completed" };
          items.push(user, answer); turns.push(turn);
          emit({ type: "agent.session.turn.item.added", event_id: `ue${sends}`, session_id: "s", turn_id: turn.id, item: user, output_index: null });
          emit({ type: "agent.session.turn.item.done", event_id: `ae${sends}`, session_id: "s", turn_id: turn.id, item: answer, output_index: 0 });
          emit({ type: "agent.session.turn.completed", event_id: `te${sends}`, session_id: "s", turn_id: turn.id, turn, usage: null });
          emit({ type: "agent.session.idle", event_id: `se${sends}`, session: session() });
        } else {
          const batch = [{ ...input, id: `u${sends}` }, { type: "agent.message", id: `a${sends}`, content: [{ type: "text", text: `Remote answer ${sends}` }] }, { type: "session.status_idle", id: `done${sends}`, stop_reason: { type: "end_turn" } }];
          events.push(...batch); batch.forEach(emit);
        }
        res.writeHead(202).end(); return;
      }
      unexpected.push(`${req.method} ${path}`); res.writeHead(404).end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      await page.evaluate(() => window.backchat.settingsPatch({ agents: [] }));
      await page.locator('[data-session-runtime-location="true"]').first().click();
      await page.getByRole("menuitem", { name: "Sign in to OpenMA", exact: true }).click();
      const form = page.getByRole("region", { name: "Agent connections" });
      await form.getByLabel("Protocol", { exact: true }).selectOption(provider);
      await form.getByLabel("Tenant name (optional)").fill(title);
      await form.getByLabel("Base URL", { exact: true }).fill(`${origin}${openai ? "/v1" : ""}`);
      await form.getByLabel("API Key", { exact: true }).fill("fake-secret");
      await form.getByRole("button", { name: "Add tenant", exact: true }).click();
      await expect(form.getByLabel("API Key", { exact: true })).toHaveValue("");
      await page.getByRole("button", { name: "Back to app" }).click();
      const nav = page.locator('[data-sidebar-scroll-area] nav');
      await nav.getByRole("button", { name: title, exact: true }).click();
      await nav.getByRole("button", { name: `New chat in ${title}`, exact: true }).click();
      await page.getByRole("menuitem", { name: openai ? /Cloud · No sandbox.*Helper/ : /Cloud · Cloud.*Helper/ }).click();
      await page.locator("textarea").fill("Remote test"); await page.locator("textarea").press("Enter");
      await expect(page.getByText("Remote answer 1", { exact: true })).toBeVisible().catch(async error => {
        console.log(JSON.stringify({ calls, sends, unexpected, snapshots: await page.evaluate(async () => Promise.all((await window.backchat.openmaTasksList()).map(t => window.backchat.openmaTaskOpen(t.id, "diagnostic")))) })); throw error;
      });
      expect(sends).toBe(1);
      const publicState = await page.evaluate(() => window.backchat.openmaAccountState());
      expect(JSON.stringify(publicState)).not.toContain("fake-secret");
      const taskId = (await page.evaluate(() => window.backchat.openmaTasksList()))[0]!.id;
      await closeApp(app);
      relaunched = await launchAppWithHome(home);
      const restored = relaunched.page;
      const restoredNav = restored.locator('[data-sidebar-scroll-area] nav');
      const tenant = restoredNav.getByRole("button", { name: title, exact: true });
      if (await tenant.getAttribute("aria-expanded") === "false") await tenant.click();
      await restoredNav.getByText("Remote test", { exact: true }).click();
      await expect(restored.getByText("Remote answer 1", { exact: true })).toBeVisible();
      expect(sends).toBe(1);
      await restored.locator("textarea").fill("Continue"); await restored.locator("textarea").press("Enter");
      await expect(restored.getByText("Remote answer 2", { exact: true })).toBeVisible().catch(async error => {
        console.log(JSON.stringify({ calls, sends, unexpected, snapshots: await restored.evaluate(async () => Promise.all((await window.backchat.openmaTasksList()).map(t => window.backchat.openmaTaskOpen(t.id, "diagnostic")))) })); throw error;
      });
      expect(creates).toBe(1); expect(sends).toBe(2);
      expect((await restored.evaluate(() => window.backchat.openmaTasksList()))[0]!.id).toBe(taskId);
      expect(unexpected).toEqual([]);
      expect(calls.some(c => (!native && c.includes("/oma/")) || c.includes("/cli/login") || c.includes("/responses"))).toBe(false);
    } finally {
      if (relaunched) await closeApp(relaunched.app);
      for (const stream of streams) stream.end(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
