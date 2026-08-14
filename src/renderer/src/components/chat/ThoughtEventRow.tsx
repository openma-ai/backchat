import { BrainIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";

import { useI18n } from "@/lib/i18n";
import { DisclosureChevron } from "@/components/ui/disclosure-chevron";
import type { Turn } from "@/lib/session-store";
import { preserveScrollAnchor } from "@/lib/utils";
import { StreamdownText } from "./ChatMarkdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { StreamingThoughtProjection } from "./StreamingThoughtProjection";

export interface ThoughtEventProjection {
  leading?: ReactNode;
  summary: ReactNode;
}

/** The atomic thought row owns the thought's presentation. Parent disclosures
 * project this exact state instead of interpreting thought events themselves. */
export function projectThoughtEvent({
  turnId,
  text,
  live,
  prefixSkip,
  liveFallback,
  completedLabel,
}: {
  turnId: string;
  text: string;
  live: boolean;
  prefixSkip: number;
  liveFallback: string;
  completedLabel: string;
}): ThoughtEventProjection {
  if (live) {
    const body = text.replace(/\s+/g, " ").trim() || liveFallback;
    return {
      summary: (
        <StreamingThoughtProjection
          turnId={turnId}
          prefixSkip={prefixSkip}
          fallback={body}
          mode="body"
        />
      ),
    };
  }
  return {
    leading: (
      <BrainIcon
        className="chat-activity-icon shrink-0 text-fg-muted"
        aria-hidden="true"
      />
    ),
    summary: completedLabel,
  };
}

export function ThoughtEventRow({
  turn,
  text,
  index,
  cwd,
  live,
  prefixSkip,
  durationSeconds,
}: {
  turn: Turn;
  text: string;
  index: number;
  cwd: string | null;
  live: boolean;
  prefixSkip: number;
  durationSeconds: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const stick = useStickToBottomContext();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const projection = projectThoughtEvent({
    turnId: turn.id,
    text,
    live,
    prefixSkip,
    liveFallback: t("chat.thinking"),
    completedLabel: t("chat.thoughtFor", { seconds: durationSeconds }),
  });

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
    <div className="py-0.5" data-thought-block="true" data-thought-live={live}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
        className="activity-disclosure-row min-h-6 text-[13px]"
      >
        {projection.leading && (
          <span className="grid size-[var(--chat-activity-icon-size)] shrink-0 place-items-center">
            {projection.leading}
          </span>
        )}
        <span className="min-w-0 truncate text-left text-fg-muted">
          {projection.summary}
        </span>
        <DisclosureChevron open={open} />
      </button>

      {open && (
        <div className="ml-5 mt-1 min-w-0">
          {live ? (
            <StreamingMarkdown
              turnId={turn.id}
              kind="thought"
              cwd={cwd}
              prefixSkip={prefixSkip}
              className="text-fg-muted"
              paceReplay
            />
          ) : (
            <StreamdownText
              className="font-chat text-[13px] leading-6 text-fg-muted"
              text={text}
              cwd={cwd}
              sessionId={turn.sessionId}
              surfacePrefix={`${turn.id}-thought-${index}`}
            />
          )}
        </div>
      )}
    </div>
  );
}
