import {
  detectSkillName,
  pickToolTarget,
} from "@/lib/chat-tool-presentation";
import type { TurnRender } from "@/lib/reduce-turn";

export type ActivityTool = TurnRender["tools"][number];

export interface ActivityToolProjection {
  activeTool: ActivityTool | undefined;
  visibleToolIds: ReadonlySet<string>;
}

export interface ActivityToolGroups {
  byStartIndex: ReadonlyMap<number, ActivityTool[]>;
  trailing: ActivityTool[];
}

export function projectActivityTools(
  rendered: TurnRender,
  isStreaming: boolean,
): ActivityToolProjection {
  const activeTools = isStreaming
    ? rendered.tools.filter((tool) => isToolRunning(tool.status))
    : [];
  const activeTool = activeTools.at(-1);
  const latestCompletedBySignature = new Map<string, string>();

  for (const tool of rendered.tools) {
    if (isStreaming && isToolRunning(tool.status)) continue;
    latestCompletedBySignature.set(
      activityToolSignature(tool),
      tool.toolCallId,
    );
  }
  if (activeTool) {
    latestCompletedBySignature.delete(activityToolSignature(activeTool));
  }

  return {
    activeTool,
    visibleToolIds: new Set(latestCompletedBySignature.values()),
  };
}

export function groupActivityTools({
  rendered,
  visibleToolIds,
  activeTool,
  groupAcrossThoughts,
}: {
  rendered: TurnRender;
  visibleToolIds: ReadonlySet<string>;
  activeTool: ActivityTool | undefined;
  groupAcrossThoughts: boolean;
}): ActivityToolGroups {
  const toolsById = new Map(
    rendered.tools.map((tool) => [tool.toolCallId, tool] as const),
  );
  const activeId = activeTool?.toolCallId;
  const byStartIndex = new Map<number, ActivityTool[]>();
  let currentStart: number | undefined;
  let current: ActivityTool[] = [];
  let activeWasPlaced = false;

  const flush = () => {
    if (currentStart !== undefined && current.length > 0) {
      byStartIndex.set(currentStart, current);
    }
    currentStart = undefined;
    current = [];
  };

  rendered.timeline.forEach((item, index) => {
    if (groupAcrossThoughts && item.kind === "thought") return;
    if (item.kind !== "tool") {
      flush();
      return;
    }

    const tool = toolsById.get(item.toolCallId);
    if (!tool) return;
    const visible =
      visibleToolIds.has(item.toolCallId) || item.toolCallId === activeId;
    if (!visible) return;

    if (hasAlwaysVisibleToolContent(tool)) {
      flush();
      byStartIndex.set(index, [tool]);
      if (item.toolCallId === activeId) activeWasPlaced = true;
      return;
    }

    if (currentStart === undefined) currentStart = index;
    current.push(tool);
    if (item.toolCallId === activeId) activeWasPlaced = true;
  });
  flush();

  return {
    byStartIndex,
    trailing: activeTool && !activeWasPlaced ? [activeTool] : [],
  };
}

export function isToolRunning(status?: string): boolean {
  return (
    status === undefined ||
    status === "pending" ||
    status === "in_progress"
  );
}

function activityToolSignature(tool: ActivityTool): string {
  const skill = detectSkillName(tool);
  return [
    tool.kind ?? "",
    skill ? `skill:${skill.toLowerCase()}` : pickToolTarget(tool),
  ].join(":");
}

function hasAlwaysVisibleToolContent(tool: ActivityTool): boolean {
  if (
    tool.content?.some(
      (block) =>
        block.type === "content" &&
        block.content?.type === "image",
    )
  ) {
    return true;
  }
  const ui = tool.meta?.ui;
  return (
    (ui != null && typeof ui === "object") ||
    typeof tool.meta?.["ui/resourceUri"] === "string"
  );
}
