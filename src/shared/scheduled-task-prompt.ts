export interface ScheduledTaskPromptSurface {
  id?: string;
  name: string;
  prompt: string;
}

export function wrapScheduledTaskPrompt(input: {
  id?: string;
  name: string;
  prompt: string;
}): string {
  const attrs = [
    input.id ? `id="${escapeAttr(input.id)}"` : null,
    `name="${escapeAttr(input.name)}"`,
  ].filter((part): part is string => part != null);
  return `<scheduled_task ${attrs.join(" ")}>${input.prompt}</scheduled_task>`;
}

export function parseScheduledTaskPrompt(
  text: string | undefined,
): ScheduledTaskPromptSurface | null {
  if (!text) return null;
  const match = /^<scheduled_task\b([^>]*)>([\s\S]*)<\/scheduled_task>\s*$/.exec(
    text.trim(),
  );
  if (!match) return null;
  const attrs = parseAttrs(match[1] ?? "");
  const name = attrs.name?.trim();
  if (!name) return null;
  return {
    ...(attrs.id ? { id: attrs.id } : {}),
    name,
    prompt: (match[2] ?? "").trim(),
  };
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /(\w+)="([^"]*)"/g;
  let hit: RegExpExecArray | null;
  while ((hit = pattern.exec(raw))) {
    const key = hit[1];
    const value = hit[2];
    if (!key || value == null) continue;
    out[key] = unescapeAttr(value);
  }
  return out;
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function unescapeAttr(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
