import type { TranslationKey } from "@/lib/i18n";
/** Presentation status for a tool call the agent stopped reporting on — the
 * process was killed, or the turn ended without a terminal update. The value
 * matches the lifecycle vocabulary ToolRow already renders. */
export const INTERRUPTED_TOOL_STATUS = "cancelled";

/** Settle a tool status for a turn that is no longer running. A call still
 * sitting at pending/in_progress after its turn ended will never receive an
 * update, so showing it as "运行中" with a spinner is a lie that survives
 * restarts — the events replay from disk in the same shape. */
export function settleInterruptedToolStatus(
  status: string | undefined,
): string {
  if (status === undefined || status === "pending" || status === "in_progress") {
    return INTERRUPTED_TOOL_STATUS;
  }
  return status;
}

export interface ChatToolPresentationInput {
  kind?: string;
  status?: string;
  title?: string;
  locations?: Array<{ path?: string }>;
  content?: Array<{
    type: string;
    path?: string;
    content?: {
      type?: string;
      text?: string;
    };
  }>;
  rawInput?: unknown;
}

/** The i18n key for what a tool call is doing, or did.
 *
 * These used to be Chinese literals returned straight into JSX, which made the
 * agent's actions the one part of the transcript that ignored the language
 * setting. Returning a key keeps the mapping from ACP tool kinds here, where the
 * protocol knowledge lives, and leaves the wording to the translator. */
export function toolVerbKey(
  kind: string | undefined,
  status: string | undefined,
): TranslationKey {
  // A call the agent never finished reporting on. ACP v1's ToolCallStatus is
  // only pending/in_progress/completed/failed, so an interrupted call has no
  // wire status of its own — the host settles it for presentation rather than
  // claim it either ran to completion or failed.
  if (status === INTERRUPTED_TOOL_STATUS) return "tool.interrupted";
  const inProgress = status === "in_progress";
  switch (kind) {
    case "read":
      return inProgress ? "tool.reading" : "tool.read";
    case "edit":
      return inProgress ? "tool.editing" : "tool.edited";
    case "delete":
      return inProgress ? "tool.deleting" : "tool.deleted";
    case "move":
      return inProgress ? "tool.moving" : "tool.moved";
    case "search":
    case "grep":
      return inProgress ? "tool.searching" : "tool.searched";
    case "execute":
    case "terminal":
      return inProgress ? "tool.running" : "tool.ran";
    case "fetch":
    case "web":
      return inProgress ? "tool.fetching" : "tool.fetched";
    case "think":
      return inProgress ? "tool.thinking" : "tool.thought";
    case "list":
    case "tree":
      return inProgress ? "tool.listing" : "tool.listed";
    case "switch_mode":
      return "tool.switchMode";
    default:
      return inProgress ? "tool.calling" : "tool.called";
  }
}

export function pickToolTarget(tool: ChatToolPresentationInput): string {
  if (tool.title) return tool.title;
  if (tool.locations?.length && tool.locations[0]?.path) {
    return shortToolPath(tool.locations[0].path);
  }
  for (const block of tool.content ?? []) {
    if (block.type === "diff" && block.path) {
      return shortToolPath(block.path);
    }
    if (
      block.type === "content"
      && block.content?.type === "text"
      && block.content.text
    ) {
      return block.content.text.split(/\r?\n/, 1)[0]!.trim();
    }
  }
  return "";
}

export function detectSkillName(
  tool: ChatToolPresentationInput,
): string | null {
  const skillPattern =
    /\/skills\/(?:\.system\/)?([^/]+)\/SKILL\.md(?:$|[?#])/i;
  for (const location of tool.locations ?? []) {
    const match = location.path?.match(skillPattern);
    if (match?.[1]) return match[1];
  }
  const rawInput = tool.rawInput as { command?: unknown } | null | undefined;
  if (rawInput && Array.isArray(rawInput.command)) {
    for (const argument of rawInput.command) {
      if (typeof argument !== "string") continue;
      const match = argument.match(skillPattern);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

export function toolActivityVerbKey(
  tool: ChatToolPresentationInput,
): TranslationKey {
  if (tool.status === INTERRUPTED_TOOL_STATUS) {
    return toolVerbKey(tool.kind, tool.status);
  }
  const status =
    tool.status === undefined ||
    tool.status === "pending" ||
    tool.status === "in_progress"
      ? "in_progress"
      : tool.status;
  return detectSkillName(tool)
    ? status === "in_progress"
      ? "tool.reading"
      : "tool.read"
    : toolVerbKey(tool.kind, status);
}

export function pickToolActivityTarget(
  tool: ChatToolPresentationInput,
): string {
  const skillName = detectSkillName(tool);
  return skillName
    ? `${capitalizeToolLabel(skillName)} 技能`
    : pickToolTarget(tool);
}

export function capitalizeToolLabel(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function shortToolPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}
