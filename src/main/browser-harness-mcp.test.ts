import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserHarnessMcpBridge,
  type BrowserHarnessToolTarget,
} from "./browser-harness-mcp";

const bridges: BrowserHarnessMcpBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
});

function target(): BrowserHarnessToolTarget {
  return {
    tabs: vi.fn(async () => ({ active_tab_id: null, tabs: [] })),
    navigate: vi.fn(async (_taskId, url) => ({ tab_id: "tab-1", url })),
    click: vi.fn(async () => "clicked"),
    type: vi.fn(async () => "typed"),
    getText: vi.fn(async () => "page text"),
    evaluate: vi.fn(async () => ({ ok: true })),
    screenshot: vi.fn(async () => ({
      media_type: "image/png" as const,
      data: Buffer.from("browser-image").toString("base64"),
      tab_id: "tab-1",
      url: "https://example.com",
    })),
    close: vi.fn(async () => ({ active_tab_id: null, tabs: [] })),
  };
}

describe("BrowserHarnessMcpBridge", () => {
  it("exposes the visible task browser as a task-scoped authenticated MCP", async () => {
    const tools = target();
    const bridge = new BrowserHarnessMcpBridge(tools, { token: "test-token" });
    bridges.push(bridge);
    await bridge.start();

    const descriptor = bridge.descriptor("task/one");
    expect(descriptor).toMatchObject({
      type: "http",
      name: "Backchat Browser",
      headers: [{ name: "Authorization", value: "Bearer test-token" }],
    });

    const client = new Client({ name: "browser-harness-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: {
        headers: Object.fromEntries(
          descriptor.headers.map(({ name, value }) => [name, value]),
        ),
      },
    });
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "browser_tabs",
      "browser_navigate",
      "browser_screenshot",
      "browser_click",
      "browser_type",
      "browser_get_text",
      "browser_eval",
      "browser_close",
    ]);

    await client.callTool({
      name: "browser_navigate",
      arguments: { url: "https://example.com/path" },
    });
    expect(tools.navigate).toHaveBeenCalledWith(
      "task/one",
      "https://example.com/path",
    );

    const screenshot = await client.callTool({
      name: "browser_screenshot",
      arguments: {},
    });
    expect(screenshot.content).toEqual([
      {
        type: "image",
        mimeType: "image/png",
        data: Buffer.from("browser-image").toString("base64"),
      },
      expect.objectContaining({ type: "text" }),
    ]);

    await client.close();
  });
});
