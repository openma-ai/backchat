import { useCallback, useState } from "react";
import { BackchatCrashMark } from "@/components/BackchatCrashMark";
import { ChevronDownIcon } from "@/components/Icons";
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

/** Full-window renderer crash surface — dialog-style card, left-aligned copy. */
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
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-16">
        <div
          className="reveal-in w-full max-w-sm overflow-hidden rounded-xl shadow-sm ring-1 ring-foreground/10 app-panel-surface"
          data-renderer-error-fallback="true"
          data-renderer-crash-card="true"
        >
          <div className="px-5 pb-4 pt-5">
            <div
              className="renderer-crash-mark-slot mb-4"
              data-renderer-crash-mark-slot="true"
            >
              <BackchatCrashMark />
            </div>
            <h1
              data-slot="dialog-title"
              className="text-base font-medium leading-snug text-fg"
            >
              {t("crash.title")}
            </h1>
            <p
              data-slot="dialog-description"
              className="mt-2 text-sm leading-relaxed text-fg-muted"
            >
              {t("crash.description")}
            </p>
          </div>

          <div className="border-t border-border px-5 py-3">
            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <CollapsibleTrigger
                className={cn(
                  "app-no-drag flex w-full items-center justify-between gap-2 rounded-lg py-1.5",
                  "text-left text-sm text-fg-muted hover:text-fg",
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
          </div>

          <div
            className="grid grid-cols-2 gap-2 border-t border-border bg-muted/50 px-5 py-3"
            data-renderer-crash-actions="true"
          >
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-full"
              onClick={() => void copyDetails()}
            >
              {copyLabel}
            </Button>
            <Button
              type="button"
              className="h-9 w-full rounded-full"
              onClick={() => window.location.reload()}
            >
              {t("crash.reload")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
