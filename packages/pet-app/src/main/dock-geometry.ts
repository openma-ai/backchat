import type { Rectangle } from "electron";
import { execFileSync } from "node:child_process";
import type { Rect } from "./edge-geometry";

export type DisplayGeometryLike = {
  bounds: Rect;
  workArea: Rect;
};

type DockPinning = "start" | "middle" | "end";

type DockPreferences = {
  iconCount: number;
  pinning: DockPinning;
  tileSize: number;
};

const MIN_DOCK_RESERVE = 20;
let cachedPreferences: DockPreferences | null = null;

export function inferDockBoundsForDisplay(display: DisplayGeometryLike): Rectangle | undefined {
  const accessibleDockBounds = readAccessibleDockBounds(display);
  if (accessibleDockBounds) return accessibleDockBounds;

  const reserve = dockReserveForDisplay(display);
  if (!reserve) return undefined;

  return inferDockBoundsFromReserve(display, reserve, readDockPreferences());
}

export function inferDockBoundsForDisplayWithPreferences(
  display: DisplayGeometryLike,
  preferences: DockPreferences,
): Rectangle | undefined {
  const reserve = dockReserveForDisplay(display);
  if (!reserve) return undefined;
  return inferDockBoundsFromReserve(display, reserve, preferences);
}

function inferDockBoundsFromReserve(
  display: DisplayGeometryLike,
  reserve: { edge: "left" | "right" | "bottom"; depth: number },
  preferences: DockPreferences,
): Rectangle {
  if (reserve.edge === "bottom") {
    const width = estimateDockLength(display.bounds.width, preferences, reserve.depth);
    return {
      x: pinOffset(display.bounds.x, display.bounds.width, width, preferences.pinning),
      y: display.bounds.y + display.bounds.height - reserve.depth,
      width,
      height: reserve.depth,
    };
  }

  const height = estimateDockLength(display.bounds.height, preferences, reserve.depth);
  return {
    x: reserve.edge === "left" ? display.bounds.x : display.bounds.x + display.bounds.width - reserve.depth,
    y: pinOffset(display.bounds.y, display.bounds.height, height, preferences.pinning),
    width: reserve.depth,
    height,
  };
}

function dockReserveForDisplay(display: DisplayGeometryLike):
  | { edge: "left" | "right" | "bottom"; depth: number }
  | undefined {
  const { bounds, workArea } = display;
  const left = workArea.x - bounds.x;
  const right = bounds.x + bounds.width - (workArea.x + workArea.width);
  const bottom = bounds.y + bounds.height - (workArea.y + workArea.height);
  const reserves = [
    { edge: "left" as const, depth: left },
    { edge: "right" as const, depth: right },
    { edge: "bottom" as const, depth: bottom },
  ].filter((item) => item.depth >= MIN_DOCK_RESERVE);
  return reserves.sort((a, b) => b.depth - a.depth)[0];
}

function readDockPreferences(): DockPreferences {
  if (cachedPreferences) return cachedPreferences;
  cachedPreferences = {
    iconCount: readDockIconCount() ?? 10,
    pinning: readDockPinning(),
    tileSize: Number(readDockDefault("tilesize")) || 48,
  };
  return cachedPreferences;
}

function readAccessibleDockBounds(display: DisplayGeometryLike): Rectangle | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const output = execFileSync(
      "/usr/bin/osascript",
      [
        "-e",
        'tell application "System Events" to tell process "Dock" to get {role, position, size, name} of UI elements',
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      },
    );
    const parsed = parseAccessibleDockBounds(output, display);
    if (!parsed && process.env["ELECTRON_RENDERER_URL"]) {
      console.warn("[pet-dock-geometry] AX Dock probe returned unparsed output", output.trim());
    }
    return parsed;
  } catch (error) {
    if (process.env["ELECTRON_RENDERER_URL"]) {
      console.warn("[pet-dock-geometry] AX Dock probe failed", error);
    }
    return undefined;
  }
}

export function parseAccessibleDockBounds(output: string, display: DisplayGeometryLike): Rectangle | undefined {
  const match = output.match(/AXList,\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const rect = {
    x: Math.round(Number(match[1])),
    y: Math.round(Number(match[2])),
    width: Math.round(Number(match[3])),
    height: Math.round(Number(match[4])),
  };
  const screenRight = display.bounds.x + display.bounds.width;
  const screenBottom = display.bounds.y + display.bounds.height;
  const isHorizontalDock = rect.width >= rect.height;

  if (isHorizontalDock && rect.y >= display.bounds.y + display.bounds.height / 2) {
    if (!overlapsRange(rect.x, rect.x + rect.width, display.bounds.x, display.bounds.x + display.bounds.width)) {
      return undefined;
    }
    const bottomReserveDepth = Math.max(0, screenBottom - (display.workArea.y + display.workArea.height));
    const hasBottomReserve = bottomReserveDepth >= MIN_DOCK_RESERVE;
    return {
      x: clamp(rect.x, display.bounds.x, screenRight - Math.min(rect.width, display.bounds.width)),
      y: hasBottomReserve ? display.workArea.y + display.workArea.height : clamp(rect.y, display.bounds.y, screenBottom - rect.height),
      width: Math.min(rect.width, display.bounds.width),
      height: hasBottomReserve ? bottomReserveDepth : rect.height,
    };
  }

  if (isHorizontalDock) {
    return undefined;
  }

  return {
    x: rect.x < display.bounds.x + display.bounds.width / 2
      ? display.bounds.x
      : screenRight - rect.width,
    y: clamp(rect.y, display.bounds.y, display.bounds.y + display.bounds.height - rect.height),
    width: rect.width,
    height: Math.min(rect.height, display.bounds.height),
  };
}

function readDockPinning(): DockPinning {
  const pinning = readDockDefault("pinning");
  if (pinning === "start" || pinning === "middle" || pinning === "end") return pinning;
  return "start";
}

function readDockIconCount(): number | null {
  const appCount = countDockTiles("persistent-apps");
  const otherCount = countDockTiles("persistent-others");
  const recentCount = countDockTiles("recent-apps");
  const total = appCount + otherCount + recentCount;
  return total > 0 ? total : null;
}

function countDockTiles(key: string): number {
  try {
    const output = execFileSync("defaults", ["read", "com.apple.dock", key], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.match(/tile-type/g)?.length ?? 0;
  } catch {
    return 0;
  }
}

function readDockDefault(key: string): string {
  try {
    return execFileSync("defaults", ["read", "com.apple.dock", key], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function estimateDockLength(axisLength: number, preferences: DockPreferences, reserveDepth: number): number {
  const iconSlot = Math.max(preferences.tileSize, Math.round(reserveDepth * 0.66));
  const length = preferences.iconCount * iconSlot + Math.max(96, reserveDepth * 1.4);
  return Math.round(Math.min(axisLength, length));
}

function pinOffset(axisStart: number, axisLength: number, dockLength: number, pinning: DockPinning): number {
  if (pinning === "start") return axisStart;
  if (pinning === "end") return axisStart + axisLength - dockLength;
  return axisStart + Math.round((axisLength - dockLength) / 2);
}

function overlapsRange(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && end > otherStart;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
