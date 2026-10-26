import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { elicitationCallbackForSession } from "../src/main/acp-client-callback-adapters.js";
import type { ElicitationFormRequestInfo } from "../src/shared/api.js";
import { expect, test } from "./fixtures";
import { enableAgent, injectSession } from "./helpers";

const dshFixture = JSON.parse(readFileSync(
  new URL("../src/main/__fixtures__/dsh-user-questions-elicitation.json", import.meta.url),
  "utf8",
)) as {
  requests: { multi: Record<string, unknown>; planReview: Record<string, unknown> };
};

async function normalizedForm(requestName: "multi" | "planReview") {
  let form: ElicitationFormRequestInfo | undefined;
  const callback = elicitationCallbackForSession({
    sessionId: "sess-dsh",
    requestForm: async (request: ElicitationFormRequestInfo) => {
      form = request;
      return { action: "decline" as const };
    },
  } as never);
  if (!callback) throw new Error("form callback was not registered");
  await callback(dshFixture.requests[requestName] as never);
  if (!form?.questions) throw new Error(`dsh ${requestName} questions were not normalized`);
  return form;
}

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  await page.evaluate(async (next) => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, theme: next, language: "en" },
    });
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", theme);
}

test("renders and answers dsh multi and plan-review asks in the composer slot", async ({
  page,
  bridge,
}, testInfo) => {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, {
    sessionId: "sess-dsh",
    agentId: "codex-acp",
    cwd: "/tmp/backchat-dsh-user-questions",
  });
  const screenshotDir = dirname(testInfo.outputPath("placeholder"));
  await mkdir(screenshotDir, { recursive: true });

  await setTheme(page, "light");
  const multi = await normalizedForm("multi");
  await bridge.beginBrokerRequest({
    kind: "elicitation-form",
    sessionId,
    params: multi as unknown as Record<string, unknown>,
  });

  const ask = page.locator('[data-composer-ask-slot="true"]');
  const multiForm = page.locator('[data-elicitation-form="questions"]');
  await expect(ask).toBeVisible();
  await expect(multiForm).toBeVisible();
  await expect(multiForm.locator("[data-elicitation-question]")).toHaveCount(3);
  const multiScreenshot = join(screenshotDir, "dsh-multi-light.png");
  await ask.screenshot({ path: multiScreenshot });
  console.log(`dsh multi screenshot: ${multiScreenshot}`);

  await page.locator('[data-elicitation-question="target"]')
    .locator('[data-elicitation-choice="option_1"]').click();
  const checks = page.locator('[data-elicitation-question="checks"]');
  await checks.locator('[data-elicitation-choice="option_0"] input').check();
  await checks.locator('[data-elicitation-choice="option_2"] input').check();
  await page.locator('[data-elicitation-question="notes"]')
    .locator('[name="question_2"]').fill("Use node 24");
  await multiForm.getByRole("button", { name: "Submit" }).click();
  await expect(ask).toHaveCount(0);

  await setTheme(page, "light");
  const planReview = await normalizedForm("planReview");
  await bridge.beginBrokerRequest({
    kind: "elicitation-form",
    sessionId,
    params: planReview as unknown as Record<string, unknown>,
  });
  const planAsk = page.locator('[data-composer-ask-slot="true"]');
  const planForm = page.locator('[data-elicitation-form="plan-review"]');
  await expect(planForm).toBeVisible();
  await expect(planAsk.getByRole("heading", { name: "Ship the release" })).toBeVisible();
  const planLightScreenshot = join(screenshotDir, "dsh-plan-review-light.png");
  await planAsk.screenshot({ path: planLightScreenshot });
  console.log(`dsh plan-review light screenshot: ${planLightScreenshot}`);

  await setTheme(page, "dark");
  const planDarkScreenshot = join(screenshotDir, "dsh-plan-review-dark.png");
  await planAsk.screenshot({ path: planDarkScreenshot });
  console.log(`dsh plan-review dark screenshot: ${planDarkScreenshot}`);
});
