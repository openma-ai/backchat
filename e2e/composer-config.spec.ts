import { expect, test } from "./fixtures";

import { enableAgent, injectEvent, injectSession } from "./helpers";

test.describe("composer configuration", () => {
  test("model picker switches the active session config option", async ({ page, bridge }) => {
    await enableAgent(page, "claude-acp");
    const sessionId = await injectSession(page);
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "e2e-config-catalogue",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-5-mini",
            options: [
              { value: "gpt-5-mini", name: "GPT-5 mini" },
              { value: "gpt-5", name: "GPT-5" },
            ],
          },
        ],
      },
    });

    const modelPicker = page.getByRole("button", {
      name: /Run on Local with .* using/,
    });
    await expect(modelPicker).toContainText("GPT-5 mini");

    await modelPicker.click();
    await page
      .getByRole("menuitem", { name: "Model GPT-5 mini", exact: true })
      .hover();
    await page.getByRole("menuitem", { name: "GPT-5 Model" }).click();

    await expect
      .poll(async () =>
        (await bridge.readSessionConfigOptions()).map((option) => ({
          config_id: option.config_id,
          value: option.value,
        })),
      )
      .toEqual([{ config_id: "model", value: "gpt-5" }]);
    await expect(modelPicker).toContainText("GPT-5");
  });
});
