import { COMPOSER_BOX_CLASS } from "@/lib/composer-box";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { hideNoticePermanently, useNoticeHidden } from "@/lib/notice-preferences";
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
  const { t } = useI18n();
  const hidden = useNoticeHidden(notice.message);
  if (hidden) return null;
  return (
    <StatusNotice
      tone={notice.tone}
      appearance="quiet"
      data-testid="composer-notice"
      dismissLabel={dismissLabel}
      onDismiss={onDismiss}
      actions={<button type="button" onClick={() => {
        hideNoticePermanently(notice.message);
        onDismiss();
      }} className="shrink-0 rounded px-1 text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring">
        {t("chat.dontShowNoticeAgain")}
      </button>}
      className={cn(COMPOSER_BOX_CLASS, "px-4 py-3")}
    >
      {notice.message}
    </StatusNotice>
  );
}
