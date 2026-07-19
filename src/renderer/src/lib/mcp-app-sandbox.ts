export { buildMcpAppDocument } from "@shared/mcp-app-document.js";

export function clampMcpAppHeight(height: number | undefined): number {
  if (height == null || !Number.isFinite(height)) return 360;
  return Math.max(160, Math.min(720, Math.ceil(height)));
}
