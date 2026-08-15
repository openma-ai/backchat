export type SiteLocale = "en" | "zh-CN";

export function localePath(locale: SiteLocale, path: "/" | "/deepseek/"): string {
  if (locale === "en") return path;
  return path === "/" ? "/zh/" : `/zh${path}`;
}

export function alternateLocale(locale: SiteLocale): SiteLocale {
  return locale === "en" ? "zh-CN" : "en";
}
