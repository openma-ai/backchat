import { resolve } from "node:path";
import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("standard compaction patches one entity and never creates a thought event", async ({ page }) => {
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const send = (event: unknown) => injectEvent(page, { type: "session.event", session_id: sessionId, turn_id: "standard-compact", event });
  await send({ sessionUpdate: "compaction_update", compactionId: "compact-1", status: "in_progress" });
  const compact = page.locator('[data-compaction-id="compact-1"]');
  await expect(compact).toHaveCount(1);
  await expect(compact).toHaveAttribute("data-compaction-status", "in_progress");
  await expect(compact).toContainText("Compacting context");
  await expect(page.locator('[data-thinking-fallback="true"]')).toHaveCount(0);
  await send({ sessionUpdate: "compaction_summary_chunk", compactionId: "compact-1", content: { type: "text", text: "Retained project context" } });
  await send({ sessionUpdate: "compaction_update", compactionId: "compact-1", status: "completed" });
  await expect(compact).toHaveCount(1);
  await expect(compact).toHaveAttribute("data-compaction-status", "completed");
  await compact.locator("summary").click();
  await expect(compact).toContainText("Retained project context");
  await send({ sessionUpdate: "compaction_update", compactionId: "compact-1", status: "failed", error: "Test compaction failure", summary: null });
  await expect(compact.locator("details")).toHaveCount(0);
  await expect(compact).toContainText("Test compaction failure");
  await expect(compact.locator('[data-tool-call-id]')).toHaveCount(0);
});

test("negotiates standard compaction over ACP and replays the persisted boundary", async ({ page, home }) => {
  const id = "compaction-wire-session";
  await injectSession(page, { sessionId: id, agentId: "codex-acp", cwd: home });
  await page.evaluate(async ({ id, cwd, node, agent }) => {
    await window.backchat.settingsPatch({ agents: [{ id: "codex-acp", enabled: true, command_override: node, args_override: [agent], env: [] }] });
    await window.backchat.sessionStart({ session_id: id, agent_id: "codex-acp", cwd });
  }, { id, cwd: home, node: process.execPath, agent: resolve("e2e/fixtures/fake-acp-agent.mjs") });
  await page.evaluate(id => window.backchat.sessionPrompt({ session_id: id, turn_id: "wire-turn", text: "standard-compaction-e2e" }), id);
  const compact = page.locator('[data-compaction-id="wire-compact"]');
  const reveal = async () => {
    const trigger = page.locator('[data-session-process-state] > [data-slot="collapsible-trigger"]').last();
    if (await trigger.getAttribute("aria-expanded") === "false") await trigger.click();
  };
  await reveal();
  await expect(compact).toHaveAttribute("data-compaction-status", "completed");
  await page.reload();
  await page.locator('[data-sidebar-card="session:compaction-wire-session"]').click();
  await reveal();
  await expect(compact).toHaveAttribute("data-compaction-status", "completed");
  await compact.locator("summary").click();
  await expect(compact).toContainText("Wire retained context");
});
