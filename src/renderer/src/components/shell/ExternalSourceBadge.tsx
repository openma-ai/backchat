import { useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";

/** Icon-only mark. The title stays in the row; the tooltip names the caller. */
export function ExternalSourceBadge({ client }: { client: string }) {
  const { t } = useI18n();
  const label = t("session.startedBy", { client });
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    placement: "above" | "below";
  } | null>(null);
  return (
    <span
      data-testid="external-source-badge"
      aria-label={label}
      className="inline-flex size-3.5 shrink-0 items-center justify-center text-fg-subtle"
      onMouseEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const aboveTop = rect.top - 6;
        const placement = aboveTop < 32 ? "below" : "above";
        setTip({
          x: rect.left + rect.width / 2,
          y: placement === "above" ? rect.top : rect.bottom,
          placement,
        });
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
          className={[
            "pointer-events-none fixed z-[200] max-w-[min(20rem,calc(100vw-1rem))] -translate-x-1/2 rounded-md border border-border bg-bg-surface px-1.5 py-0.5 text-center text-[11px] leading-4 text-fg shadow-md",
            tip.placement === "above"
              ? "-translate-y-full"
              : "translate-y-1",
          ].join(" ")}
          style={{
            left: tip.x,
            top: tip.y,
          }}
        >
          {label}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
