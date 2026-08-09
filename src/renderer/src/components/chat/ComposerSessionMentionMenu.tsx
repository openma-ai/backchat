import {
  AtSignIcon,
  CornerDownLeftIcon,
  FileTextIcon,
  FolderOpenIcon,
} from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { ComposerMentionCandidate } from "@/lib/composer-mentions";

export function ComposerSessionMentionMenu({
  candidates,
  selectedIndex,
  onHighlight,
  onPick,
}: {
  candidates: readonly ComposerMentionCandidate[];
  selectedIndex: number;
  onHighlight: (index: number) => void;
  onPick: (candidate: ComposerMentionCandidate) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="session-mention-panel composer-overlay-panel app-overlay-surface composer-card absolute bottom-full z-30"
      role="listbox"
      aria-label={t("chat.mentionSessions")}
    >
      <div className="session-mention-section-label" aria-hidden="true">
        <AtSignIcon className="size-3" />
        <span>{t("chat.mentionSessions")}</span>
      </div>
      {candidates.map((candidate, index) => (
        <button
          key={candidate.id}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          aria-label={candidate.kind === "file"
            ? `@${candidate.label} · file`
            : candidate.kind === "browse"
              ? `@${candidate.label} · browse`
              : `@${candidate.label} · ${candidate.agentId}`}
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onPick(candidate)}
          className="session-mention-item"
        >
          <span className="session-mention-icon" aria-hidden="true">
            {candidate.kind === "file"
              ? <FileTextIcon className="size-3.5" />
              : candidate.kind === "browse"
                ? <FolderOpenIcon className="size-3.5" />
                : <AtSignIcon className="size-3.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">
              {candidate.label}
            </span>
            <span className="block truncate text-[11px] text-fg-subtle">
              {candidate.kind === "file"
                ? candidate.path
                : candidate.kind === "browse"
                  ? "Select from any folder"
                  : `${candidate.agentId} · ${candidate.id.slice(0, 12)}`}
            </span>
          </span>
          <CornerDownLeftIcon className="session-mention-enter size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
