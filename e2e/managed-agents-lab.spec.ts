import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { launchApp } from "./helpers";

async function openManagedAgentsLab(page: Awaited<ReturnType<typeof launchApp>>["page"]) {
  const expandSidebar = page.getByRole("button", { name: "Expand sidebar" });
  if (await expandSidebar.isVisible()) await expandSidebar.click();
  await page.getByRole("link", { name: "Managed Agents Lab" }).click();
}

test("Managed Agents Lab is reachable and keeps credentials behind the main-process boundary", async ({}, testInfo) => {
  const { page, cleanup } = await launchApp();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openManagedAgentsLab(page);

    await expect(page.getByRole("heading", { name: "Managed Agents Lab" })).toBeVisible();
    await expect(page.getByLabel("Endpoint")).toHaveValue("https://app.staging.openma.dev");
    await expect(page.getByLabel("API key")).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Run cloud agent" })).toBeDisabled();
    await expect(page.getByText("Credentials handled by the isolated main process")).toBeVisible();
    await expect(page.getByText("Ready for a real run")).toBeVisible();

    const screenshotPath = testInfo.outputPath("managed-agents-lab.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("Managed Agents Lab", {
      path: screenshotPath,
      contentType: "image/png",
    });
  } finally {
    await cleanup();
  }
});

test("Managed Agents Lab discovers endpoint models and keeps its configuration surface wireless", async () => {
  const requests: Array<{
    method?: string;
    path?: string;
    beta?: string | null;
    limit?: string | null;
    apiKey?: string;
  }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({
      method: request.method,
      path: url.pathname,
      beta: url.searchParams.get("beta"),
      limit: url.searchParams.get("limit"),
      apiKey: request.headers["x-api-key"] as string | undefined,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      data: [
        {
          id: "fast",
          display_name: "Fast",
          type: "model",
          created_at: "2026-08-07T00:00:00.000Z",
          capabilities: null,
          max_input_tokens: null,
          max_tokens: null,
          allowed_fallback_models: null,
        },
        {
          id: "deep",
          display_name: "Deep Reasoning",
          type: "model",
          created_at: "2026-08-06T00:00:00.000Z",
          capabilities: null,
          max_input_tokens: null,
          max_tokens: null,
          allowed_fallback_models: null,
        },
      ],
      has_more: false,
      first_id: "fast",
      last_id: "deep",
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const { page, cleanup } = await launchApp();

  try {
    await openManagedAgentsLab(page);
    await page.getByLabel("Endpoint").fill(`http://127.0.0.1:${address.port}`);
    await page.getByLabel("API key").fill("oma_endpoint_key");

    const picker = page.getByRole("combobox", { name: "Model" });
    await picker.click();
    await expect(page.getByRole("option", { name: /fast.*Fast/i })).toBeVisible();
    await page.getByRole("option", { name: /deep.*Deep Reasoning/i }).click();
    await expect(picker).toContainText("deep");

    expect(requests).toEqual([{
      method: "GET",
      path: "/v1/models",
      beta: "true",
      limit: "100",
      apiKey: "oma_endpoint_key",
    }]);

    const configChrome = await page.getByTestId("managed-lab-config").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderTop: style.borderTopWidth,
        borderRight: style.borderRightWidth,
        borderBottom: style.borderBottomWidth,
        borderLeft: style.borderLeftWidth,
        boxShadow: style.boxShadow,
      };
    });
    expect(configChrome).toEqual({
      borderTop: "0px",
      borderRight: "0px",
      borderBottom: "0px",
      borderLeft: "0px",
      boxShadow: "none",
    });
  } finally {
    await cleanup();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
