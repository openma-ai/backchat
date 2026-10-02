import { useI18n } from "@/lib/i18n";

/** Icon-only mark. The title stays in the row; the tooltip names the caller. */
export function ExternalSourceBadge({ client }: { client: string }) {
  const { t } = useI18n();
  const label = t("session.startedBy", { client });
  return (
    <span
      data-testid="external-source-badge"
      title={label}
      aria-label={label}
      className="inline-flex size-3.5 shrink-0 items-center justify-center text-fg-subtle"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
        <circle cx="8" cy="5.5" r="2.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 13.2c.7-2.2 2.4-3.3 4.5-3.3s3.8 1.1 4.5 3.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}
