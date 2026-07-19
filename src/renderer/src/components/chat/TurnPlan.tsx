import {
  CheckSquareIcon,
  ListChecksIcon,
  Loader2Icon,
  SquareIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export function TurnPlan({
  entries,
}: {
  entries: { content: string; status?: string }[];
}) {
  const total = entries.length;
  const done = entries.filter((entry) => entry.status === "completed").length;

  return (
    <div className="rounded-lg border border-border/40 bg-bg-surface/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 text-fg-muted">
        <ListChecksIcon className="size-3.5" />
        <span className="text-xs">Plan</span>
        <span className="text-xs text-fg-subtle">
          {done} / {total}
        </span>
      </div>
      <ul className="space-y-0.5">
        {entries.map((entry, index) => {
          const Icon =
            entry.status === "completed"
              ? CheckSquareIcon
              : entry.status === "in_progress"
                ? Loader2Icon
                : SquareIcon;
          return (
            <li
              key={index}
              className={cn(
                "flex items-start gap-2 rounded-md px-1.5 py-1 text-sm",
                entry.status === "in_progress" &&
                  "border-l-2 border-fg-subtle bg-bg-surface/40 pl-2",
              )}
            >
              <Icon
                className={cn(
                  "mt-1 size-3.5 shrink-0",
                  entry.status === "completed"
                    ? "text-success"
                    : entry.status === "in_progress"
                      ? "text-fg-muted animate-spin"
                      : "text-fg-subtle",
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 leading-6",
                  entry.status === "completed"
                    ? "text-fg-muted line-through"
                    : entry.status === "in_progress"
                      ? "text-fg"
                      : "text-fg-muted",
                )}
              >
                {entry.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
