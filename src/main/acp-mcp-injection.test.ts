import { describe, expect, it } from "vitest";
import { buildAcpMcpServers } from "./acp-mcp-injection.js";

describe("buildAcpMcpServers", () => {
  it("preserves every ACP-supported MCP transport without leaking mutable settings", () => {
    const configured = [
      {
        id: "local",
        type: "stdio" as const,
        name: "Local tools",
        command: "node",
        args: ["server.mjs"],
        env: [{ name: "TOKEN", value: "secret" }],
      },
      {
        id: "remote",
        type: "http" as const,
        name: "Remote tools",
        url: "https://example.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer token" }],
      },
      {
        id: "legacy",
        type: "sse" as const,
        name: "Legacy tools",
        url: "https://example.com/sse",
        headers: [],
      },
    ];

    const injected = buildAcpMcpServers(configured, {
      id: "backchat-browser",
      type: "http",
      name: "Backchat Browser",
      url: "http://127.0.0.1:3210/mcp/task-a",
      headers: [],
    });

    expect(injected).toHaveLength(4);
    expect(injected[3]).toMatchObject({ id: "backchat-browser" });
    expect(injected.every((server) => server._meta["io.modelcontextprotocol/ui"].host === "backchat")).toBe(true);
    expect(injected).not.toBe(configured);
    expect(injected[0]).not.toBe(configured[0]);
    expect(injected[0]).toMatchObject({ env: [{ name: "TOKEN", value: "secret" }] });
    expect(injected[1]).toMatchObject({ headers: [{ name: "Authorization", value: "Bearer token" }] });
  });

  it("omits a missing task-scoped server", () => {
    expect(buildAcpMcpServers([], undefined)).toEqual([]);
  });
});
