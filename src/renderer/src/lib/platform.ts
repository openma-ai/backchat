/**
 * Host OS as seen by the renderer. Electron's user agent names the OS
 * ("Macintosh", "Windows", "Linux"/"X11"), so this needs no IPC and is
 * available on first paint.
 */
export type HostPlatform = "mac" | "windows" | "linux";

export function detectHostPlatform(userAgent: string): HostPlatform {
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "mac";
  if (/Windows/i.test(userAgent)) return "windows";
  return "linux";
}

export const hostPlatform: HostPlatform =
  typeof navigator === "undefined" ? "mac" : detectHostPlatform(navigator.userAgent);

/** The system file manager under the name the OS itself uses in that
 *  language (macOS calls Finder 访达 in Simplified Chinese). */
export function fileManagerName(locale: "en" | "zh-CN", platform: HostPlatform = hostPlatform): string {
  if (platform === "mac") return locale === "zh-CN" ? "访达" : "Finder";
  if (platform === "windows") return locale === "zh-CN" ? "资源管理器" : "File Explorer";
  return locale === "zh-CN" ? "文件管理器" : "file manager";
}
