import { describe, expect, it } from "vitest";
import {
  MCP_APP_DISPLAY_MODES,
  mcpAppFrameHeight,
  negotiateMcpAppDisplayModes,
  resolveMcpAppDisplayMode,
  resolvePipDockAction,
} from "./mcp-app-display.js";

describe("MCP App display modes", () => {
  it("supports all three official containers", () => {
    expect(MCP_APP_DISPLAY_MODES).toEqual(["inline", "fullscreen", "pip"]);
    expect(resolveMcpAppDisplayMode("fullscreen", "inline")).toBe("fullscreen");
    expect(resolveMcpAppDisplayMode("pip", "inline")).toBe("pip");
    expect(resolveMcpAppDisplayMode("unknown", "pip")).toBe("pip");
  });

  it("only exposes display modes supported by both the host and the GUI", () => {
    expect(negotiateMcpAppDisplayModes(
      MCP_APP_DISPLAY_MODES,
      ["inline", "pip"],
    )).toEqual(["inline", "pip"]);
    expect(negotiateMcpAppDisplayModes(
      MCP_APP_DISPLAY_MODES,
      undefined,
    )).toEqual(["inline"]);
  });

  it("rejects a GUI mode request outside the negotiated modes", () => {
    expect(resolveMcpAppDisplayMode("pip", "inline", ["inline", "fullscreen"])).toBe("inline");
  });

  it("uses bounded inline height and lets picture in picture fill its host", () => {
    expect(mcpAppFrameHeight("inline", 200)).toBe(200);
    expect(mcpAppFrameHeight("pip", 900)).toBe("100%");
    expect(mcpAppFrameHeight("fullscreen", 200)).toBe("calc(100% - 36px)");
  });

  it("uses fullscreen when docking a PIP GUI that supports it", () => {
    expect(resolvePipDockAction(["inline", "fullscreen", "pip"])).toBe("fullscreen");
  });

  it("keeps the protocol mode as PIP when docking a PIP-only GUI", () => {
    expect(resolvePipDockAction(["inline", "pip"])).toBe("dock");
  });
});
