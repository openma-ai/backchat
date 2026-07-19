import { MessageSquareTextIcon, ScanSearchIcon, XIcon } from "lucide-react";

import type { PromptAnnotation, PromptAttachment } from "@shared/session-events.js";
import {
  browserAnnotationScreenshotName,
  isBrowserPageAnnotation,
} from "@/lib/browser-element-annotation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { numberPromptAnnotations } from "@/lib/prompt-annotations";

export function ComposerAnnotationStrip({
  annotations,
  attachments,
  onRemove,
}: {
  annotations: PromptAnnotation[];
  attachments: PromptAttachment[];
  onRemove: (annotationId: string) => void;
}) {
  const browserOnly = annotations.every(isBrowserPageAnnotation);
  const label = annotationCountLabel(annotations.length, browserOnly);
  const TriggerIcon = browserOnly ? ScanSearchIcon : MessageSquareTextIcon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-lg bg-bg/55 px-2.5 ring-1 ring-border/60",
            "text-xs font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35",
          )}
        >
          <TriggerIcon className="size-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        aria-label="Response annotations"
        className="w-[min(420px,calc(100vw-24px))] gap-0 p-3"
      >
        <div className="max-h-72 overflow-y-auto">
          {numberPromptAnnotations(annotations).map(({ annotation, index }) => {
            const summary = annotationSummary(annotation);
            const screenshot = annotationAttachment(annotation, attachments);
            return (
              <div
                key={annotation.id}
                className="flex items-start gap-2 border-b border-border/50 py-2 first:pt-0 last:border-b-0 last:pb-0"
              >
                <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-fg-subtle">
                  {index}.
                </span>
                <div className="min-w-0 flex-1">
                  {screenshot?.data && screenshot.mimeType && (
                    <img
                      src={`data:${screenshot.mimeType};base64,${screenshot.data}`}
                      alt={`Screenshot for annotation ${index}`}
                      className="mb-2 h-16 w-24 rounded-md border border-border/60 object-cover object-top"
                    />
                  )}
                  <div className="text-[11px] text-fg-subtle">
                    {summary.sourceLabel}
                  </div>
                  <p className="mt-0.5 line-clamp-5 whitespace-pre-wrap text-sm leading-5 text-fg">
                    {summary.primaryText}
                  </p>
                  {summary.sourceUrl && (
                    <p
                      className="mt-1 truncate text-[11px] text-fg-subtle"
                      title={summary.sourceUrl}
                    >
                      {summary.sourceText}
                    </p>
                  )}
                  {annotation.comment?.trim() && (
                    <div className="mt-2">
                      <div className="text-[11px] text-fg-subtle">Comment</div>
                      <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-fg-muted">
                        {annotation.comment.trim()}
                      </p>
                    </div>
                  )}
                  {annotation.browser?.style_changes?.length ? (
                    <div className="mt-2 space-y-1">
                      {annotation.browser.style_changes.map((change) => (
                        <div
                          key={change.property}
                          className="truncate font-mono text-[11px] text-fg-muted"
                          title={`${change.property}: ${change.from} -> ${change.to}`}
                        >
                          {change.property}: {change.from} → {change.to}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(annotation.id)}
                  aria-label={`Remove annotation ${index}`}
                  title="Remove annotation"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-subtle hover:text-danger"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function annotationSummary(annotation: PromptAnnotation): {
  sourceLabel: string;
  primaryText: string;
  sourceText?: string;
  sourceUrl?: string;
} {
  if (annotation.kind === "browser_element" && annotation.browser) {
    return {
      sourceLabel: "Page element",
      primaryText: browserElementIdentity(annotation.browser),
      sourceText: annotation.browser.title || annotation.browser.url,
      sourceUrl: annotation.browser.url,
    };
  }
  if (annotation.kind === "browser_region" && annotation.browser_region) {
    const { browser_region: region } = annotation;
    return {
      sourceLabel: "Page region",
      primaryText:
        annotation.text ||
        `Region ${Math.round(region.rect.width)}x${Math.round(region.rect.height)}`,
      sourceText: region.title || region.url,
      sourceUrl: region.url,
    };
  }
  return {
    sourceLabel: "Selected text",
    primaryText: annotation.text,
  };
}

export function annotationAttachment(
  annotation: PromptAnnotation,
  attachments: PromptAttachment[],
): PromptAttachment | null {
  const screenshotName = browserAnnotationScreenshotName(annotation);
  if (!screenshotName) return null;
  return (
    attachments.find((attachment) => attachment.name === screenshotName) ?? null
  );
}

function browserElementIdentity(
  browser: NonNullable<PromptAnnotation["browser"]>,
): string {
  if (browser.id) return `${browser.tag_name}#${browser.id}`;
  const ariaLabel = browser.aria_label?.trim();
  if (ariaLabel) {
    return `${browser.tag_name}[aria-label=${JSON.stringify(ariaLabel)}]`;
  }
  const stableClass = browser.class_names.find(
    (name) => name.length <= 32 && !/^[a-zA-Z0-9_-]{10,}$/.test(name),
  );
  return stableClass
    ? `${browser.tag_name}.${stableClass}`
    : browser.tag_name;
}

function annotationCountLabel(count: number, browserOnly = false): string {
  if (browserOnly) {
    return `${count} ${count === 1 ? "page annotation" : "page annotations"}`;
  }
  return `${count} ${count === 1 ? "annotation" : "annotations"}`;
}
