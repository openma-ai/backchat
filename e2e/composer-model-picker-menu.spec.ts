import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession } from "./helpers";

test("model picker search filters by provider and model name", async ({ page, bridge }) => {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "model-picker-filter",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "a-1",
          options: [
            {
              group: "anthropic-proxy",
              name: "anthropic-proxy",
              options: [
                { value: "a-1", name: "Claude Sonnet" },
                { value: "a-2", name: "Claude Haiku" },
              ],
            },
            {
              group: "devin",
              name: "devin",
              options: [{ value: "d-1", name: "Devin Default" }],
            },
          ],
        },
      ],
    },
  });

  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  await page.getByRole("menuitem", { name: /模型|Model/ }).hover();
  const search = page.getByRole("searchbox");
  await expect(search).toBeFocused();
  await search.fill("devin");
  const listbox = page.getByRole("listbox", { name: "Options" });
  await expect(listbox.getByText("Devin Default")).toBeVisible();
  await expect(listbox.getByText("Claude Sonnet")).toHaveCount(0);
});
