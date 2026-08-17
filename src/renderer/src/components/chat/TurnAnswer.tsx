import type { TurnRender } from "@/lib/reduce-turn";
import type { Turn } from "@/lib/session-store";
import { processTimelineEndIndex } from "@/lib/turn-timeline-sections";
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
        <div className="min-w-0" data-session-turn-answer="true">
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
  const processEndIndex = processTimelineEndIndex(rendered.timeline);
  const lastTimelineItem = rendered.timeline.at(-1);
  const liveTailIndex =
    isStreaming &&
    lastTimelineItem?.kind === "assistant_text" &&
    rendered.timeline.length - 1 > processEndIndex
      ? rendered.timeline.length - 1
      : undefined;

  return rendered.timeline.map((item, index) => {
    if (item.kind !== "assistant_text") return null;
    const prefix = assistantPrefix;
    assistantPrefix += item.text.length;
    if (index <= processEndIndex) return null;
    if (index === liveTailIndex) {
      return (
        <div
          key={`answer-${index}`}
          className="min-w-0"
          data-session-turn-answer="true"
        >
          <StreamingMarkdown
            turnId={turn.id}
            kind="assistant"
            cwd={cwd}
            prefixSkip={prefix}
            // A segment that opens after a tool break already holds the chunk
            // that created it, and writing that at once made every paragraph
            // after the first appear as a block while the first one streamed.
            // The turn is still running, so the reader is watching this now.
            paceReplay
          />
        </div>
      );
    }
    return (
      <div
        key={`answer-${index}`}
        className="min-w-0"
        data-session-turn-answer="true"
      >
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
