import {
  CheckSquareIcon,
  ChevronRightIcon,
  CircleSlashIcon,
  ListChecksIcon,
  Loader2Icon,
  SquareIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export function TaskListActivity({
  items,
}: {
  items: { label: string; status?: string }[];
}) {
  const total = items.length;
  const terminal = items.filter(
    (item) => item.status === "completed" || item.status === "cancelled",
  ).length;
  const current =
    items.find((item) => item.status === "in_progress") ??
    items.find(
      (item) =>
        item.status !== "completed" && item.status !== "cancelled",
    ) ??
    items.at(-1);
  const [open, setOpen] = useState(false);

  return (
    <div className="py-0.5" data-plan-activity="true">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="activity-disclosure-row"
      >
        <ListChecksIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0 font-semibold text-fg">Plan</span>
        <span className="min-w-0 flex-1 truncate text-fg-muted">
          {current?.label}
        </span>
        <span className="shrink-0 text-fg-subtle tabular-nums">
          {terminal} / {total}
        </span>
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      <ul className="ml-5 mt-1 space-y-0.5" hidden={!open}>
          {items.map((item, index) => {
            const Icon =
              item.status === "completed"
                ? CheckSquareIcon
                : item.status === "cancelled"
                  ? CircleSlashIcon
                : item.status === "in_progress"
                  ? Loader2Icon
                  : SquareIcon;
            return (
              <li
                key={index}
                data-task-status={item.status ?? "pending"}
                className="flex items-start gap-2 rounded px-1.5 py-1 text-sm"
              >
                <Icon
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    item.status === "completed"
                      ? "text-success"
                      : item.status === "cancelled"
                        ? "text-fg-subtle"
                      : item.status === "in_progress"
                        ? "animate-spin text-fg-muted"
                        : "text-fg-subtle",
                  )}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 leading-5",
                    item.status === "completed" ||
                    item.status === "cancelled"
                      ? "text-fg-muted line-through"
                      : item.status === "in_progress"
                        ? "text-fg"
                        : "text-fg-muted",
                  )}
                >
                  {item.label}
                </span>
              </li>
            );
          })}
        </ul>
    </div>
  );
}
