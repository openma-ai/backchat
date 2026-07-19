import visualizeBaseCss from "./visualize-assets/visualize.css.txt?raw";
import visualizeBaseHtml from "./visualize-assets/visualize.html?raw";

export type InlineVisualizationSegment =
  | { kind: "markdown"; text: string }
  | { kind: "visualization"; file: string };

const INLINE_VIS_DIRECTIVE =
  /::(?:codex|openma)-inline-vis\{file="([a-zA-Z0-9][a-zA-Z0-9._/-]*\.html?)"\}/g;

function isSafeVisualizationPath(file: string): boolean {
  if (file.startsWith("/") || file.includes("\\")) return false;
  return file.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function splitInlineVisualizations(text: string): InlineVisualizationSegment[] {
  const segments: InlineVisualizationSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_VIS_DIRECTIVE)) {
    const file = match[1];
    const index = match.index;
    if (!file || index === undefined || !isSafeVisualizationPath(file)) continue;
    if (index > cursor) segments.push({ kind: "markdown", text: text.slice(cursor, index) });
    segments.push({ kind: "visualization", file });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: "markdown", text: text.slice(cursor) });
  return segments.length > 0 ? segments : [{ kind: "markdown", text }];
}

const THEME_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "viz-series-1",
  "viz-series-2",
  "viz-series-3",
  "viz-series-4",
  "viz-series-5",
  "viz-series-6",
  "font-size-base",
] as const;

export function resolveInlineVisualizationTheme(
  tokens: Record<string, string>,
): Record<string, string> {
  const value = (name: string) => tokens[name]?.trim() || "";
  const background = value("--bg");
  const surface = value("--bg-surface") || background;
  const foreground = value("--fg");
  const mutedForeground = value("--fg-muted") || foreground;
  const border = value("--border");
  const strongBorder = value("--border-strong") || border;
  return {
    background,
    foreground,
    card: surface,
    "card-foreground": foreground,
    popover: surface,
    "popover-foreground": foreground,
    primary: foreground,
    "primary-foreground": background,
    secondary: surface,
    "secondary-foreground": foreground,
    muted: surface,
    "muted-foreground": mutedForeground,
    accent: value("--bg-bubble") || surface,
    "accent-foreground": foreground,
    destructive: value("--danger"),
    border,
    input: border,
    ring: strongBorder,
    "viz-series-1": value("--brand") || foreground,
    "viz-series-2": value("--warning") || mutedForeground,
    "viz-series-3": value("--success") || strongBorder,
    "viz-series-4": value("--accent-violet") || foreground,
    "viz-series-5": value("--info") || mutedForeground,
    "viz-series-6": value("--danger") || border,
    "font-size-base": tokens["font-size"]?.trim() || "13px",
  };
}

function safeCssValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || /[;{}]/.test(trimmed)) return fallback;
  return trimmed;
}

export function buildInlineVisualizationDocument(
  fragment: string,
  theme: Record<string, string>,
): string {
  const fallback: Record<(typeof THEME_KEYS)[number], string> = {
    background: "Canvas",
    foreground: "CanvasText",
    card: "var(--background)",
    "card-foreground": "var(--foreground)",
    popover: "var(--card)",
    "popover-foreground": "var(--card-foreground)",
    primary: "var(--foreground)",
    "primary-foreground": "var(--background)",
    secondary: "var(--muted)",
    "secondary-foreground": "var(--foreground)",
    muted: "color-mix(in srgb, var(--foreground) 7%, transparent)",
    "muted-foreground": "color-mix(in srgb, var(--foreground) 62%, transparent)",
    accent: "color-mix(in srgb, var(--foreground) 10%, transparent)",
    "accent-foreground": "var(--foreground)",
    destructive: "#dc2626",
    border: "color-mix(in srgb, var(--foreground) 14%, transparent)",
    input: "var(--border)",
    ring: "color-mix(in srgb, var(--foreground) 35%, transparent)",
    "viz-series-1": "var(--primary)",
    "viz-series-2": "var(--muted-foreground)",
    "viz-series-3": "var(--primary)",
    "viz-series-4": "var(--muted-foreground)",
    "viz-series-5": "var(--primary)",
    "viz-series-6": "var(--muted-foreground)",
    "font-size-base": "13px",
  };
  const themeCss = THEME_KEYS.map(
    (key) => `--${key}:${safeCssValue(theme[key], fallback[key])}`,
  ).join(";");
  const content = visualizeBaseHtml
    .replace("<!--__INLINE_VISUALIZATION_FRAGMENT__-->", fragment)
    .replace(
      '<script id="codex-visualization-lucide" async src="https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js"></script>',
      '<script id="codex-visualization-lucide" src="oma-mcp-app://view/__assets/lucide@1.17.0.js"></script>',
    );

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net; style-src 'unsafe-inline' https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net; font-src data: https://fonts.gstatic.com https://fonts.bunny.net; script-src 'unsafe-inline' oma-mcp-app: https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${visualizeBaseCss}
:root{${themeCss}}
</style>
</head>
<body>
${content}
<script>
(() => {
  const post = (type, payload = {}) => parent.postMessage({ type, ...payload }, "*");
  const followUp = async ({ prompt, title } = {}) => {
    if (typeof prompt !== "string" || !prompt.trim()) return;
    post("openma:inline-visualization:follow-up", { prompt: prompt.trim(), title: typeof title === "string" ? title : undefined });
  };
  window.openma = { sendFollowUpMessage: followUp };
  window.openai = { sendFollowUpMessage: followUp };
  let previousHeight = 0;
  const reportHeight = () => {
    const height = Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    if (height !== previousHeight) {
      previousHeight = height;
      post("openma:inline-visualization:resize", { height });
    }
  };
  const observer = new ResizeObserver(reportHeight);
  observer.observe(document.body);
  window.addEventListener("load", reportHeight, { once: true });
  requestAnimationFrame(reportHeight);
})();
</script>
</body>
</html>`;
}

export function clampInlineVisualizationHeight(height: number | undefined): number {
  if (height == null || !Number.isFinite(height)) return 1;
  return Math.max(1, Math.min(4_096, Math.ceil(height)));
}
