import type { SettingsMcpServer } from "../shared/settings.js";

export type AcpMcpServer = SettingsMcpServer & {
  /** ACP extension hint for harnesses that can negotiate MCP Extensions.
   * Unknown ACP `_meta` keys are required to be ignored, so older agents
   * keep working while extension-aware harnesses can advertise Host support. */
  _meta: {
    "io.modelcontextprotocol/ui": {
      host: "backchat";
      mimeTypes: ["text/html;profile=mcp-app"];
    };
  };
};

function cloneServer(server: SettingsMcpServer): AcpMcpServer {
  const _meta: AcpMcpServer["_meta"] = {
    "io.modelcontextprotocol/ui": {
      host: "backchat",
      mimeTypes: ["text/html;profile=mcp-app"],
    },
  };
  if (server.type === "stdio") {
    return {
      ...server,
      args: [...server.args],
      env: server.env.map((entry) => ({ ...entry })),
      _meta,
    };
  }
  return {
    ...server,
    headers: server.headers.map((entry) => ({ ...entry })),
    _meta,
  };
}

/** Build the opaque ACP `session/new.mcpServers` payload in one place.
 * ACP agents own the actual MCP connection; Backchat only injects the
 * user's configured servers plus task-scoped built-ins. */
export function buildAcpMcpServers(
  configured: readonly SettingsMcpServer[],
  taskScoped?: SettingsMcpServer | readonly SettingsMcpServer[],
): AcpMcpServer[] {
  const builtIns = taskScoped
    ? Array.isArray(taskScoped) ? taskScoped : [taskScoped]
    : [];
  return [
    ...configured.map(cloneServer),
    ...builtIns.map(cloneServer),
  ];
}
