import { StatusNotice } from "@/components/ui/status-notice";
import type { SessionNotice } from "@/lib/session-store";

export function ComposerNotice({
  notice,
  dismissLabel,
  onDismiss,
}: {
  notice: SessionNotice;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <StatusNotice
      tone={notice.tone}
      appearance="quiet"
      data-testid="composer-notice"
      dismissLabel={dismissLabel}
      onDismiss={onDismiss}
      className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
    >
      {notice.message}
    </StatusNotice>
  );
}
