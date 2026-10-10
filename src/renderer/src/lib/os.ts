export type RendererOs = "windows" | "mac" | "linux";

/** Chromium's Linux `system-ui` is fontconfig. The renderer tags the
 *  document so the font stack can name a real family per OS. */
export function detectRendererOs(userAgent: string): RendererOs {
  if (/Windows/.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "mac";
  return "linux";
}

export function applyRendererOs(
  root: { dataset: { os?: string } },
  userAgent: string,
): RendererOs {
  const os = detectRendererOs(userAgent);
  root.dataset.os = os;
  return os;
}
