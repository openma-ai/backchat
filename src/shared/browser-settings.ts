import type { SettingsBrowser } from "./settings.js";

export const DEFAULT_BROWSER_SETTINGS: SettingsBrowser = {
  enabled: true,
  web_link_target: "external",
  local_link_target: "in_app",
  annotation_screenshots: "always",
  default_zoom: 1,
  download_path: "",
  ask_before_download: false,
  autofill_enabled: false,
};

export function browserSettings(
  value?: Partial<SettingsBrowser> | null,
): SettingsBrowser {
  return { ...DEFAULT_BROWSER_SETTINGS, ...value };
}

export function isLocalBrowserUrl(rawUrl: string): boolean {
  if (/^file:/i.test(rawUrl)) return true;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return host === "localhost"
      || host.endsWith(".localhost")
      || host === "::1"
      || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

export function browserOpenTarget(
  url: string,
  value?: Partial<SettingsBrowser> | null,
): "external" | "in_app" {
  const settings = browserSettings(value);
  if (!settings.enabled) return "external";
  return isLocalBrowserUrl(url)
    ? settings.local_link_target
    : settings.web_link_target;
}

export function shouldAttachBrowserAnnotationScreenshot(
  value?: Partial<SettingsBrowser> | null,
): boolean {
  return browserSettings(value).annotation_screenshots === "always";
}
