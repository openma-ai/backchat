import { ShimmerText } from "@/components/ui/ShimmerText";
import { useI18n } from "@/lib/i18n";
import { StreamdownText } from "./ChatMarkdown";

export interface CompactionState {
  id: string;
  status: string;
  summary?: readonly unknown[];
  error?: string;
}

/** A protocol entity, not a synthetic thought or tool call. */
export function CompactionActivity({ compaction }: { compaction: CompactionState }) {
  const { t } = useI18n();
  const label = t(compaction.status === "in_progress" ? "chat.compacting"
    : compaction.status === "completed" ? "chat.compacted"
      : compaction.status === "failed" ? "chat.compactionFailed"
        : compaction.status === "cancelled" ? "chat.compactionCancelled" : "chat.compaction");
  const summary = (compaction.summary ?? []).flatMap(block => {
    if (!block || typeof block !== "object") return [];
    const value = block as Record<string, unknown>;
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join("");
  const title = compaction.status === "in_progress" ? <ShimmerText>{label}</ShimmerText> : label;
  return (
    <div className="min-w-0 py-1 text-[13px] leading-6 text-fg-muted" data-compaction-id={compaction.id} data-compaction-status={compaction.status}>
      {summary.trim() ? (
        <details>
          <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2">{title}</summary>
          <div className="mt-2 min-w-0"><StreamdownText text={summary} cwd={null} sessionId="" surfacePrefix={`compaction-${compaction.id}`} /></div>
        </details>
      ) : <span role={compaction.status === "in_progress" ? "status" : undefined}>{title}</span>}
      {compaction.error && <p className="mt-1 text-danger">{compaction.error}</p>}
    </div>
  );
}
