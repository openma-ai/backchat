import type { TurnRender } from "@/lib/reduce-turn";
import type { Turn } from "@/lib/session-store";
import {
  ASSISTANT_MARKDOWN_CLASS,
  StreamdownText,
} from "./ChatMarkdown";
import { StreamingMarkdown } from "./StreamingMarkdown";

export function TurnAnswer({
  turn,
  rendered,
  cwd,
  isStreaming,
}: {
  turn: Turn;
  rendered: TurnRender;
  cwd: string | null;
  isStreaming: boolean;
}) {
  const timeline = renderAnswerTimeline(turn, rendered, cwd, isStreaming);
  const hasAssistantTimeline = rendered.timeline.some(
    (item) => item.kind === "assistant_text",
  );

  return (
    <>
      {timeline}
      {!isStreaming && !hasAssistantTimeline && turn.assistantText && (
        <div className="min-w-0">
          <StreamdownText
            className={ASSISTANT_MARKDOWN_CLASS}
            text={turn.assistantText}
            cwd={cwd}
            sessionId={turn.sessionId}
            surfacePrefix={`${turn.id}-replay`}
          />
        </div>
      )}
    </>
  );
}

function renderAnswerTimeline(
  turn: Turn,
  rendered: TurnRender,
  cwd: string | null,
  isStreaming: boolean,
) {
  let assistantPrefix = 0;
  const lastTimelineItem = rendered.timeline.at(-1);
  const liveTailIndex =
    isStreaming &&
    lastTimelineItem?.kind === "assistant_text" &&
    lastTimelineItem.phase !== "commentary"
      ? rendered.timeline.length - 1
      : undefined;

  return rendered.timeline.map((item, index) => {
    if (item.kind !== "assistant_text") return null;
    const prefix = assistantPrefix;
    assistantPrefix += item.text.length;
    if (item.phase === "commentary") return null;
    if (index === liveTailIndex) {
      return (
        <div key={`answer-${index}`} className="min-w-0">
          <StreamingMarkdown
            turnId={turn.id}
            kind="assistant"
            cwd={cwd}
            prefixSkip={prefix}
          />
        </div>
      );
    }
    return (
      <div key={`answer-${index}`} className="min-w-0">
        <StreamdownText
          className={ASSISTANT_MARKDOWN_CLASS}
          text={item.text}
          cwd={cwd}
          sessionId={turn.sessionId}
          surfacePrefix={`${turn.id}-answer-${index}`}
        />
      </div>
    );
  });
}
