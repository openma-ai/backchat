import { delimiter } from "node:path";

const MACOS_CLI_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/opt/local/bin",
];

export function desktopCliPath(
  currentPath = process.env.PATH,
  platform = process.platform,
): string {
  const existing = currentPath?.split(delimiter).filter(Boolean) ?? [];
  const preferred = platform === "darwin" ? MACOS_CLI_DIRS : [];
  return [...new Set([...preferred, ...existing])].join(delimiter);
}
