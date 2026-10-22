import {
  ChatThoughtEventRow,
  projectChatThoughtEvent,
  type ChatThoughtEventProjection,
} from "@openma/common/chat-ui";

import { useI18n } from "@/lib/i18n";
import type { Turn } from "@/lib/session-store";
import { StreamdownText } from "./ChatMarkdown";
import { StreamingMarkdown } from "./StreamingMarkdown";

export type ThoughtEventProjection = ChatThoughtEventProjection;

/** The atomic thought row owns the thought's presentation. Parent disclosures
 * project this exact state instead of interpreting thought events themselves. */
export function projectThoughtEvent({
  live,
  liveFallback,
  completedLabel,
}: {
  live: boolean;
  liveFallback: string;
  completedLabel: string;
}): ThoughtEventProjection {
  return projectChatThoughtEvent({
    live,
    liveFallback,
    completedLabel,
  });
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
  const projection = projectThoughtEvent({
    live,
    liveFallback: t("chat.thinking"),
    completedLabel: t("chat.thoughtFor", { seconds: durationSeconds }),
  });

  return (
    <ChatThoughtEventRow
      live={live}
      text={text}
      liveFallback={t("chat.thinking")}
      completedLabel={t("chat.thoughtFor", { seconds: durationSeconds })}
      projection={projection}
      renderBody={() =>
        live ? (
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
        )
      }
    />
  );
}
