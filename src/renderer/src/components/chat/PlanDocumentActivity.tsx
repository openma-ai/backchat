import { ChevronRightIcon, LightbulbIcon } from "lucide-react";
import { useState } from "react";

import type { PlanDocumentPresentation } from "@/lib/session-plan";
import { cn } from "@/lib/utils";
import {
  ASSISTANT_MARKDOWN_CLASS,
  StreamdownText,
} from "./ChatMarkdown";

export function PlanDocumentActivity({
  document,
  cwd,
  sessionId,
}: {
  document: PlanDocumentPresentation;
  cwd: string | null;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-0.5" data-plan-document="true">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="activity-disclosure-row"
      >
        <LightbulbIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0">Plan</span>
        <span className="min-w-0 flex-1 truncate text-fg-muted/80">
          {document.title ?? "Markdown document"}
        </span>
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="ml-5 mt-2" data-plan-document-content="true">
          <StreamdownText
            text={document.markdown}
            className={ASSISTANT_MARKDOWN_CLASS}
            cwd={cwd}
            sessionId={sessionId}
            surfacePrefix={`plan-${document.id ?? "current"}`}
          />
        </div>
      )}
    </div>
  );
}
