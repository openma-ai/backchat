import {
  ChevronRightIcon,
  ListChecksIcon,
  Loader2Icon,
} from "lucide-react";
import { useState } from "react";

import {
  isToolRunning,
  type ActivityTool,
} from "@/lib/activity-tool-groups";
import {
  pickToolActivityTarget,
  pickToolActivityVerb,
} from "@/lib/chat-tool-presentation";
import { useI18n } from "@/lib/i18n";
import type { SubagentActivity } from "@/lib/session-store";
import { cn } from "@/lib/utils";
import { ToolRow } from "./ToolPresentation";

export function ActivityToolGroup({
  tools,
  sessionId,
  subagents,
}: {
  tools: ActivityTool[];
  sessionId: string;
  subagents: SubagentActivity[];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (tools.length === 1) {
    const tool = tools[0]!;
    return (
      <ToolRow
        tool={tool}
        sessionId={sessionId}
        subagent={subagentForToolCall(subagents, tool.toolCallId)}
      />
    );
  }

  const running = tools.some((tool) => isToolRunning(tool.status));
  const latest =
    tools.findLast((tool) => isToolRunning(tool.status)) ?? tools.at(-1)!;
  const latestVerb = pickToolActivityVerb(latest);

  return (
    <div className="py-0.5" data-tool-group-size={tools.length}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded py-0.5 text-left text-[13px] text-fg-muted hover:bg-bg-surface/40"
      >
        {running ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <ListChecksIcon className="size-3.5 shrink-0" />
        )}
        <span className="shrink-0 whitespace-nowrap">
          {running
            ? latestVerb
            : t("chat.toolCallCount", { count: tools.length })}
        </span>
        <span className="min-w-0 flex-1 truncate text-fg-muted/70">
          {pickToolActivityTarget(latest)}
        </span>
        {running && (
          <span className="shrink-0 whitespace-nowrap text-fg-subtle">
            {t("chat.toolCallCount", { count: tools.length })}
          </span>
        )}
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3.5 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="ml-4 mt-1 border-l border-border/40 pl-2">
          {tools.map((tool) => (
            <ToolRow
              key={tool.toolCallId}
              tool={tool}
              sessionId={sessionId}
              subagent={subagentForToolCall(subagents, tool.toolCallId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function subagentForToolCall(
  subagents: SubagentActivity[],
  toolCallId: string,
): SubagentActivity | undefined {
  return subagents.find(
    (activity) => activity.native?.toolCallId === toolCallId,
  );
}
