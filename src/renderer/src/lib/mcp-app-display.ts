import { clampMcpAppHeight } from "./mcp-app-sandbox.js";

export const MCP_APP_DISPLAY_MODES = ["inline", "fullscreen", "pip"] as const;
export type McpAppDisplayMode = (typeof MCP_APP_DISPLAY_MODES)[number];

export function resolveMcpAppDisplayMode(
  requested: string,
  current: McpAppDisplayMode,
  availableDisplayModes: readonly McpAppDisplayMode[] = MCP_APP_DISPLAY_MODES,
): McpAppDisplayMode {
  return (availableDisplayModes as readonly string[]).includes(requested)
    ? requested as McpAppDisplayMode
    : current;
}

export function negotiateMcpAppDisplayModes(
  hostDisplayModes: readonly McpAppDisplayMode[],
  appDisplayModes: readonly McpAppDisplayMode[] | undefined,
): McpAppDisplayMode[] {
  const declaredModes = new Set<McpAppDisplayMode>(appDisplayModes ?? ["inline"]);
  return hostDisplayModes.filter((mode) => declaredModes.has(mode));
}

export function resolvePipDockAction(
  availableDisplayModes: readonly McpAppDisplayMode[],
): "fullscreen" | "dock" {
  return availableDisplayModes.includes("fullscreen") ? "fullscreen" : "dock";
}

export function mcpAppFrameHeight(
  mode: McpAppDisplayMode,
  requested: number | undefined,
): number | string {
  if (mode === "fullscreen") return "calc(100% - 36px)";
  if (mode === "pip") return "100%";
  const bounded = clampMcpAppHeight(requested);
  return bounded;
}
