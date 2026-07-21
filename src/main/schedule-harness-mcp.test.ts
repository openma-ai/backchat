import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ScheduleHarnessMcpBridge,
  type ScheduleHarnessToolTarget,
} from "./schedule-harness-mcp.js";

const bridges: ScheduleHarnessMcpBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
});

describe("ScheduleHarnessMcpBridge", () => {
  it("lets any task create and manage its own schedules", async () => {
    const tools: ScheduleHarnessToolTarget = {
      create: vi.fn(async (_taskId, input) => ({ id: "schedule-1", ...input })),
      list: vi.fn(async () => []),
      update: vi.fn(async (_taskId, input) => input),
      delete: vi.fn(async () => undefined),
    };
    const bridge = new ScheduleHarnessMcpBridge(tools, { token: "test-token" });
    bridges.push(bridge);
    await bridge.start();
    const descriptor = bridge.descriptor("task/one");
    const client = new Client({ name: "schedule-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: {
        headers: Object.fromEntries(
          descriptor.headers.map(({ name, value }) => [name, value]),
        ),
      },
    });
    await client.connect(transport);

    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "schedule_create",
      "schedule_list",
      "schedule_update",
      "schedule_delete",
    ]);
    await client.callTool({
      name: "schedule_create",
      arguments: {
        name: "Wake up",
        prompt: "Tell me to wake up",
        target: "current_task",
        trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
      },
    });
    expect(tools.create).toHaveBeenCalledWith("task/one", {
      name: "Wake up",
      prompt: "Tell me to wake up",
      target: "current_task",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
    });
    await client.close();
  });
});
