import { useCallback, useState } from "react";
import { ChevronDownIcon, CircleAlertIcon } from "@/components/Icons";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatRendererCrashDetails } from "@/lib/renderer-crash-report";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface RendererCrashPageProps {
  message: string;
  stack?: string;
  componentStack?: string;
}

/** Full-window renderer crash surface — matches home empty-state typography and tokens. */
export function RendererCrashPage({
  message,
  stack,
  componentStack,
}: RendererCrashPageProps) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const copyDetails = useCallback(async () => {
    const text = formatRendererCrashDetails({ message, stack, componentStack });
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2500);
    }
  }, [message, stack, componentStack]);

  const detailText = formatRendererCrashDetails({ message, stack, componentStack });
  const copyLabel =
    copyState === "done"
      ? t("crash.copied")
      : copyState === "failed"
        ? t("crash.copyFailed")
        : t("crash.copy");

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col app-canvas-surface text-fg"
      data-renderer-crash-page="true"
    >
      <div className="app-drag-region h-9 shrink-0" aria-hidden="true" />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-16">
        <div
          className="home-empty-intro reveal-in flex w-full max-w-md flex-col items-center text-center"
          data-renderer-error-fallback="true"
        >
          <div
            className="app-panel-surface w-full rounded-xl px-6 py-8 shadow-sm"
            data-renderer-crash-card="true"
          >
            <div
              className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-muted"
              aria-hidden="true"
            >
              <CircleAlertIcon className="size-6 text-fg-muted" />
            </div>
            <div className="home-hero-copy">
              <h1 className="home-hero-title text-2xl leading-tight text-fg">
                {t("crash.title")}
              </h1>
              <p className="home-hero-description mt-2 max-w-sm text-sm text-fg-muted">
                {t("crash.description")}
              </p>
            </div>

            <Collapsible
              open={detailsOpen}
              onOpenChange={setDetailsOpen}
              className="mt-6 w-full text-left"
            >
              <CollapsibleTrigger
                className={cn(
                  "app-no-drag flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2",
                  "text-sm text-fg-muted hover:bg-muted/60 hover:text-fg",
                )}
              >
                <span>{t("crash.details")}</span>
                <ChevronDownIcon
                  className={cn(
                    "size-4 shrink-0 text-fg-subtle transition-transform",
                    detailsOpen && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre
                  className="mt-2 max-h-52 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-fg-muted whitespace-pre-wrap break-words"
                  data-renderer-crash-details="true"
                >
                  {detailText}
                </pre>
              </CollapsibleContent>
            </Collapsible>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button type="button" onClick={() => window.location.reload()}>
                {t("crash.reload")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void copyDetails()}>
                {copyLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
