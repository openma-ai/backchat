import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const MACOS_CLI_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/opt/local/bin",
];

/** Directories the app tries, in order, when installing the `backchat` CLI. */
export function cliInstallCandidates(
  home = homedir(),
  platform = process.platform,
): string[] {
  const system = platform === "darwin"
    ? MACOS_CLI_DIRS
    : platform === "win32"
      ? []
      : ["/usr/local/bin"];
  return [...new Set([join(home, ".local", "bin"), ...system])];
}

export function desktopCliPath(
  currentPath = process.env.PATH,
  platform = process.platform,
): string {
  const existing = currentPath?.split(delimiter).filter(Boolean) ?? [];
  const preferred = platform === "darwin" ? MACOS_CLI_DIRS : [];
  return [...new Set([...preferred, ...existing])].join(delimiter);
}
