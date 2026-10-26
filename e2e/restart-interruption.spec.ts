import { expect, test } from "./fixtures";
import { persistSessionFixture, reloadRenderer } from "./helpers";

test("reopening unfinished persisted work without a live prompt shows interruption, not running", async ({ page }) => {
  const canonical = (type: string, data: unknown, n: number) => ({ type: "openma_event", data: {schema:"oma.event.v1",schema_version:"oma.event.v1",event_id:`orphan:${n}`,session_id:"orphan-after-exit",turn_id:"old-turn",source:{kind:"harness",harness:"codex-acp"},occurred_at:new Date(n*1000).toISOString(),type,data} });
  await persistSessionFixture(page, { sessionId: "orphan-after-exit", title: "Interrupted request", agentId: "codex-acp", cwd: "", events: [
    canonical("user.message", {text:"Work interrupted by app exit",input_kind:"prompt"}, 1),
    canonical("session.running", {}, 2),
    canonical("agent.message_chunk", {text:"Partial progress"}, 3),
  ] });
  await reloadRenderer(page);
  await page.getByRole("button", {name:"Interrupted request", exact:true}).click();
  await expect(page.getByText("Partial progress", {exact:true})).toBeVisible();
  await expect(page.locator('[data-session-turn-status="running"]')).toHaveCount(0);
  await expect(page.locator('[data-session-turn-status="cancelled"]')).toHaveCount(1);
  await expect(page.locator('[data-thinking-fallback="true"]')).toHaveCount(0);
});

test("typed restartable Codex exit is interruption, not a stuck error gate", async ({ page }) => {
  const { injectSession, injectEvent } = await import("./helpers");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {type:"session.event",session_id:sessionId,turn_id:"exit-turn",event:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"Partial output"}}});
  await injectEvent(page, {type:"session.error",session_id:sessionId,turn_id:"exit-turn",message:"Provider-specific text",error_details:{code:1001,data:{restartable:true,exitCode:0,signal:null}}});
  await expect(page.locator('[data-session-turn-status="cancelled"]')).toHaveCount(1);
  await expect(page.locator('[data-turn-stop-reason="interrupted"]')).toBeVisible();
  await expect(page.getByText("Provider-specific text", {exact:true})).toHaveCount(0);
  await expect(page.locator('[data-thinking-fallback="true"]')).toHaveCount(0);
});
