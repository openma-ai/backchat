import { memo, useMemo, type ReactNode } from "react";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { StatusNotice } from "@/components/ui/status-notice";
import { useI18n } from "@/lib/i18n";
import { reduceTurn } from "@/lib/reduce-turn";
import {
  selectAgentIdFor,
  selectSubagentsFor,
  useSessionStore,
  type Turn,
} from "@/lib/session-store";
import {
  shouldShowTransientThought,
  turnWorkDurationSeconds,
} from "@/lib/turn-presentation";
import { useMarkdownCwd } from "./ChatMarkdown";
import { TurnAnswer } from "./TurnAnswer";
import { TurnActivity } from "./TurnActivity";
import { TurnPlan } from "./TurnPlan";

export const TurnBlock = memo(function TurnBlock({ turn }: { turn: Turn }) {
  const { t } = useI18n();
  const rendered = useMemo(() => reduceTurn(turn.events), [turn.events]);
  const cwd = useMarkdownCwd();
  const subagentsSelector = useMemo(
    () => selectSubagentsFor(turn.sessionId),
    [turn.sessionId],
  );
  const subagents = useSessionStore(subagentsSelector);
  const agentIdSelector = useMemo(
    () => selectAgentIdFor(turn.sessionId),
    [turn.sessionId],
  );
  const agentId = useSessionStore(agentIdSelector);
  const isStreaming = turn.status === "running";
  const hasVisibleContent =
    turn.assistantText.length > 0 ||
    rendered.tools.length > 0 ||
    rendered.plan.length > 0;
  const hasAnything =
    hasVisibleContent ||
    shouldShowTransientThought({
      isStreaming,
      thoughtText: turn.thoughtText,
      hasVisibleContent,
    });

  return (
    <div className="group/turn reveal-in mb-6 space-y-2" data-turn-id={turn.id}>
      {turn.promptText && (
        <Message from="user">
          <MessageContent>
            <p className="whitespace-pre-wrap">{turn.promptText}</p>
          </MessageContent>
        </Message>
      )}

      <div
        data-annotatable-response
        data-annotation-ready={!isStreaming}
        data-source-session-id={turn.sessionId}
        data-source-turn-id={turn.id}
        className="min-w-0"
      >
        <AssistantGutter>
          {rendered.plan.length > 0 && <TurnPlan entries={rendered.plan} />}

          <TurnActivity
            turn={turn}
            rendered={rendered}
            subagents={subagents}
            agentId={agentId}
            isStreaming={isStreaming}
            cwd={cwd}
            completeLabel={t("chat.workedFor", {
              seconds: turnWorkDurationSeconds(turn),
            })}
          />

          <TurnAnswer
            turn={turn}
            rendered={rendered}
            cwd={cwd}
            isStreaming={isStreaming}
          />

          {!hasAnything && isStreaming && <StreamingPlaceholder />}
          {!hasAnything && turn.status === "queued" && (
            <p className="text-xs italic text-fg-subtle">queued</p>
          )}
          {turn.status === "error" && (
            <StatusNotice tone="danger">
              {turn.errorMessage ?? "Turn failed."}
            </StatusNotice>
          )}
          {turn.status === "cancelled" && (
            <p className="text-xs italic text-fg-subtle">cancelled</p>
          )}
        </AssistantGutter>
      </div>
    </div>
  );
});

function StreamingPlaceholder() {
  return (
    <p
      className="text-sm font-normal leading-6 text-fg-muted"
      aria-label="Thinking..."
      aria-live="polite"
    >
      <span aria-hidden="true">
        Thinking
        <span className="thinking-placeholder-dot">.</span>
        <span
          className="thinking-placeholder-dot"
          style={{ animationDelay: "180ms" }}
        >
          .
        </span>
        <span
          className="thinking-placeholder-dot"
          style={{ animationDelay: "360ms" }}
        >
          .
        </span>
      </span>
    </p>
  );
}

function AssistantGutter({ children }: { children: ReactNode }) {
  return <div className="min-w-0 space-y-2">{children}</div>;
}
