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

export function pickToolVerb(
  kind: string | undefined,
  status: string | undefined,
): string {
  const inProgress = status === "in_progress";
  switch (kind) {
    case "read":
      return inProgress ? "读取中" : "已读取";
    case "edit":
      return inProgress ? "编辑中" : "已编辑";
    case "delete":
      return inProgress ? "删除中" : "已删除";
    case "move":
      return inProgress ? "移动中" : "已移动";
    case "search":
    case "grep":
      return inProgress ? "搜索中" : "已搜索";
    case "execute":
    case "terminal":
      return inProgress ? "运行中" : "已运行";
    case "fetch":
    case "web":
      return inProgress ? "获取中" : "已获取";
    case "think":
      return inProgress ? "思考中" : "已思考";
    case "list":
    case "tree":
      return inProgress ? "列出中" : "已列出";
    case "switch_mode":
      return "切换模式";
    default:
      return inProgress ? "调用中" : "已调用";
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

export function pickToolActivityVerb(
  tool: ChatToolPresentationInput,
): string {
  const status =
    tool.status === undefined ||
    tool.status === "pending" ||
    tool.status === "in_progress"
      ? "in_progress"
      : tool.status;
  return detectSkillName(tool)
    ? status === "in_progress"
      ? "读取中"
      : "已读取"
    : pickToolVerb(tool.kind, status);
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
