import {
  ChevronRightIcon,
  ListChecksIcon,
  Loader2Icon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";

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
import { cn, preserveScrollAnchor } from "@/lib/utils";
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
  const stick = useStickToBottomContext();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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
  const toggleOpen = () => {
    preserveScrollAnchor({
      scrollElement: stick.scrollRef.current,
      anchorElement: triggerRef.current,
      contentElement: stick.contentRef.current,
      update: () => setOpen((value) => !value),
      stopScroll: stick.stopScroll,
    });
  };

  return (
    <div className="py-0.5" data-tool-group-size={tools.length}>
      <button
        ref={triggerRef}
        data-tool-group-trigger
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] text-fg-muted hover:bg-bg-surface/40"
      >
        <span
          data-tool-group-icon-slot
          className="grid size-5 shrink-0 place-items-center"
        >
          {running ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <ListChecksIcon className="size-3.5" />
          )}
        </span>
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
        <span
          data-tool-group-icon-slot
          className="ml-auto grid size-5 shrink-0 place-items-center"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 text-fg-subtle transition-transform",
              open && "rotate-90",
            )}
          />
        </span>
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
