import { expect, test } from "@playwright/test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { injectEvent, injectSession, launchApp } from "./helpers";

const appHtml = `<!doctype html><html><head><style>
html,body{margin:0;background:transparent;color:#e7e7e5;font:13px system-ui}body{padding:14px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.card{padding:13px;border:1px solid #555;border-radius:10px;background:#393938}
.label{color:#aaa;font-size:11px}.value{font-size:22px;margin-top:7px}.chart{height:100px;margin-top:12px;display:flex;align-items:end;gap:7px}
.bar{flex:1;border-radius:4px 4px 1px 1px;background:#aaa}.ok{color:#c9e6cf}
</style></head><body><div class="grid"><div class="card"><div class="label">REQUESTS</div><div class="value">24.8k</div></div><div class="card"><div class="label">P95 LATENCY</div><div class="value">184 ms</div></div><div class="card"><div class="label">STATUS</div><div class="value ok">Healthy</div></div></div><div class="chart">${[42,58,50,73,67,88,81,94,76,90,84,96].map((height) => `<i class="bar" style="height:${height}%"></i>`).join("")}</div><script>
window.addEventListener("message", function (event) {
  var message = event.data;
  if (!message || message.jsonrpc !== "2.0") return;
  if (message.id === 1 && message.result) {
    parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
  }
  if (message.method === "ui/resource-teardown") {
    parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
  }
});
parent.postMessage({
  jsonrpc: "2.0",
  id: 1,
  method: "ui/initialize",
  params: {
    appInfo: { name: "health-view", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen", "pip"] },
    protocolVersion: "2026-01-26"
  }
}, "*");
</script></body></html>`;

const pipOnlyAppHtml = appHtml.replace(
  'availableDisplayModes: ["inline", "fullscreen", "pip"]',
  'availableDisplayModes: ["inline", "pip"]',
);

const visualizeFragment = `<div id="performance-widget" class="viz-grid">
  <article class="card"><div class="text-small text-muted">QUEUE DEPTH</div><div class="viz-stat-value">38</div><div class="viz-badge">-12% vs last hour</div></article>
  <article class="card"><div class="text-small text-muted">THROUGHPUT</div><div class="viz-stat-value">1,284/min</div><label class="form-label text-small">Load<input class="form-range" type="range" value="68"></label></article>
  <article class="card"><div class="text-small text-muted">REGION</div><div class="viz-stat-value">Asia Pacific</div><button class="btn btn-block" data-tooltip="Inspect the selected region" onclick="openai.sendFollowUpMessage({prompt:'Inspect APAC latency'})"><i data-lucide="search" aria-hidden="true"></i>Inspect latency</button></article>
</div><output id="generation-state">initial</output><script>document.getElementById("generation-state").textContent="script-ready";</script>`;

test("MCP Apps expose three containers while Visualize stays inline", async () => {
  const server = createServer((request, response) => void handleMcpRequest(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("MCP fixture failed to bind");
  const { app, page, home, cleanup } = await launchApp({ language: "en" });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960));
    const workspace = join(home, "workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "performance-lab.html"), visualizeFragment);
    await page.evaluate(async (url) => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: { ...current.appearance, theme: "dark", language: "en" },
        mcp_servers: [{ id: "health", type: "http", name: "Health", url, headers: [] }],
      });
    }, `http://127.0.0.1:${address.port}/mcp`);

    const sessionId = await injectSession(page, { agentId: "codex-acp", cwd: workspace });
    const turnId = "turn-interactive-containers";
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: 'Live performance lab\n\n::openma-inline-vis{file="performance-lab.html"}',
        },
      },
    });
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "pip-only-tool",
        title: "PIP timer",
        toolName: "mcp__health__show_timer",
        status: "completed",
        rawInput: { duration: 300 },
        rawOutput: { content: [{ type: "text", text: "timer:300" }] },
        _meta: {
          ui: { resourceUri: "ui://health/timer.html" },
          mcp_server_name: "health",
        },
      },
    });
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "health-tool",
        title: "Service health",
        toolName: "mcp__health__show_health",
        status: "completed",
        rawInput: { region: "apac" },
        rawOutput: { content: [{ type: "text", text: "healthy:apac" }] },
        _meta: {
          ui: { resourceUri: "ui://health/dashboard.html" },
          mcp_server_name: "health",
        },
      },
    });
    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: turnId,
    });

    const visualization = page.getByRole("region", { name: "performance-lab.html" });
    const mcpApp = page.getByRole("region", { name: "Service health" });
    await expect(visualization).toBeVisible();
    await expect(mcpApp).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTitle("performance-lab.html")).toBeVisible();
    const visualizationFrame = page.frameLocator('iframe[title="performance-lab.html"]');
    await expect(visualization.getByText("performance-lab.html", { exact: true })).toHaveCount(0);
    await expect(visualizationFrame.getByText("script-ready", { exact: true })).toBeVisible();
    await expect(visualizationFrame.locator("svg.lucide-search")).toBeVisible();
    const serviceHealthFrame = page.locator('iframe[title="Service health"]');
    await expect(serviceHealthFrame).toBeVisible();
    await serviceHealthFrame.evaluate((frame) => { frame.dataset.e2eMount = "stable"; });

    const artifactDir = join(process.cwd(), "artifacts", "interactive-containers");
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: join(artifactDir, "01-inline.png"), fullPage: true });

    await writeFile(join(workspace, "performance-lab.html"), visualizeFragment.replace(
      'id="generation-state">initial',
      'id="generation-state">streamed',
    ).replace('textContent="script-ready"', 'textContent="streamed-ready"'));
    await expect(visualizationFrame.getByText("streamed-ready", { exact: true })).toBeVisible();

    await expect(visualization.getByRole("button", { name: "Right sidebar" })).toHaveCount(0);
    await expect(visualization.getByRole("button", { name: "Picture in picture" })).toHaveCount(0);

    await mcpApp.getByRole("button", { name: "Right sidebar" }).click();
    const sideMcpApp = page.getByRole("region", { name: "Service health" });
    await expect(sideMcpApp).toBeVisible();
    await expect(serviceHealthFrame).toHaveAttribute("data-e2e-mount", "stable");
    await expect(sideMcpApp.getByRole("button", { name: "Right sidebar" })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: join(artifactDir, "02-right-sidebar.png") });

    await sideMcpApp.getByRole("button", { name: "Inline" }).click();
    await expect(page.getByRole("region", { name: "Service health" })).toBeVisible();
    await page.getByRole("region", { name: "Service health" }).getByRole("button", { name: "Picture in picture" }).click();
    const pipMcpApp = page.getByRole("region", { name: "Service health" });
    const returnToSidebar = pipMcpApp.getByRole("button", { name: "Return to right sidebar" });
    await expect(returnToSidebar).toBeVisible();
    await expect(returnToSidebar.locator("svg")).toHaveClass(/lucide-panel-right/);
    await expect(pipMcpApp.getByRole("button", { name: "Close picture in picture" })).toBeVisible();
    await expect(pipMcpApp).toHaveAttribute("data-pip-window", "true");
    await expect(serviceHealthFrame).toHaveAttribute("data-e2e-mount", "stable");

    const initialBox = await pipMcpApp.boundingBox();
    expect(initialBox).not.toBeNull();
    const dragHandle = pipMcpApp.locator("[data-pip-drag-handle]");
    const dragBox = await dragHandle.boundingBox();
    expect(dragBox).not.toBeNull();
    await page.mouse.move(dragBox!.x + 120, dragBox!.y + dragBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragBox!.x + 40, dragBox!.y - 60, { steps: 4 });
    await page.mouse.up();
    const movedBox = await pipMcpApp.boundingBox();
    expect(movedBox!.x).toBeLessThanOrEqual(initialBox!.x - 50);
    expect(movedBox!.y).toBeLessThanOrEqual(initialBox!.y - 35);

    const resizeHandle = pipMcpApp.locator('[data-pip-resize="south-east"]');
    const resizeBox = await resizeHandle.boundingBox();
    expect(resizeBox).not.toBeNull();
    await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox!.x + 60, resizeBox!.y + 40, { steps: 4 });
    await page.mouse.up();
    const resizedBox = await pipMcpApp.boundingBox();
    expect(resizedBox!.width).toBeGreaterThan(movedBox!.width + 40);
    expect(resizedBox!.height).toBeGreaterThan(movedBox!.height + 20);
    await page.screenshot({ path: join(artifactDir, "03-picture-in-picture.png") });

    await pipMcpApp.getByRole("button", { name: "Return to right sidebar" }).click();
    const returnedMcpApp = page.getByRole("region", { name: "Service health" });
    await expect(returnedMcpApp.getByRole("button", { name: "Right sidebar" })).toHaveAttribute("aria-pressed", "true");

    await returnedMcpApp.getByRole("button", { name: "Picture in picture" }).click();
    const closingMcpApp = page.getByRole("region", { name: "Service health" });
    await closingMcpApp.getByRole("button", { name: "Close picture in picture" }).click();
    await expect(page.getByRole("region", { name: "Service health" })).toHaveCount(0);

    const pipOnlyApp = page.getByRole("region", { name: "PIP timer" });
    await expect(pipOnlyApp.getByRole("button", { name: "Right sidebar" })).toHaveCount(0);
    await pipOnlyApp.getByRole("button", { name: "Picture in picture" }).click();
    await pipOnlyApp.getByRole("button", { name: "Return to right sidebar" }).click();
    const dockedPipOnlyApp = page.getByRole("region", { name: "PIP timer" });
    await expect(dockedPipOnlyApp).toHaveAttribute("data-pip-docked", "true");
    await expect(dockedPipOnlyApp.getByRole("button", { name: "Open picture in picture" })).toBeVisible();
    await dockedPipOnlyApp.getByRole("button", { name: "Open picture in picture" }).click();
    await expect(page.getByRole("region", { name: "PIP timer" })).toHaveAttribute("data-pip-window", "true");
  } finally {
    await cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function createMcpAppServer(): McpServer {
  const server = new McpServer({ name: "health", version: "1.0.0" });
  registerAppTool(server, "show_health", {
    title: "Service health",
    inputSchema: { region: z.string() },
    _meta: { ui: { resourceUri: "ui://health/dashboard.html" } },
  }, async ({ region }) => ({
    content: [{ type: "text", text: `healthy:${region}` }],
  }));
  registerAppResource(server, "Health dashboard", "ui://health/dashboard.html", {}, async () => ({
    contents: [{
      uri: "ui://health/dashboard.html",
      mimeType: RESOURCE_MIME_TYPE,
      text: appHtml,
    }],
  }));
  registerAppTool(server, "show_timer", {
    title: "PIP timer",
    inputSchema: { duration: z.number() },
    _meta: { ui: { resourceUri: "ui://health/timer.html" } },
  }, async ({ duration }) => ({
    content: [{ type: "text", text: `timer:${duration}` }],
  }));
  registerAppResource(server, "PIP timer", "ui://health/timer.html", {}, async () => ({
    contents: [{
      uri: "ui://health/timer.html",
      mimeType: RESOURCE_MIME_TYPE,
      text: pipOnlyAppHtml,
    }],
  }));
  return server;
}

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpAppServer();
  try {
    await server.connect(transport);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    await transport.handleRequest(request, response, body);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
