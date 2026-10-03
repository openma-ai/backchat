import { useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";

/** Icon-only mark. The title stays in the row; the tooltip names the caller. */
export function ExternalSourceBadge({ client }: { client: string }) {
  const { t } = useI18n();
  const label = t("session.startedBy", { client });
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      data-testid="external-source-badge"
      title={label}
      aria-label={label}
      className="inline-flex size-3.5 shrink-0 items-center justify-center text-fg-subtle"
      onMouseEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setTip({ x: rect.left + rect.width / 2, y: rect.top });
      }}
      onMouseLeave={() => setTip(null)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
        <circle cx="8" cy="5.5" r="2.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3.5 13.2c.7-2.2 2.4-3.3 4.5-3.3s3.8 1.1 4.5 3.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      {tip ? createPortal(
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[80] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-bg-surface px-1.5 py-0.5 text-[11px] leading-4 text-fg shadow-md"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {label}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
