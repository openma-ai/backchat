import type { AcpSessionUsage } from "@/lib/session-types";

export type ContextUsageTone = "muted" | "warning" | "danger";

export function contextUsagePresentation(usage: AcpSessionUsage): {
  label: string;
  title: string;
  tone: ContextUsageTone;
} {
  const percentage = Math.min(
    100,
    Math.max(0, Math.round((usage.used / usage.size) * 100)),
  );
  const tone: ContextUsageTone =
    percentage >= 95 ? "danger" : percentage >= 80 ? "warning" : "muted";
  const number = new Intl.NumberFormat("en-US");
  const cost = usage.cost
    ? ` · ${number.format(usage.cost.amount)} ${usage.cost.currency}`
    : "";

  return {
    label: `Context ${percentage}%`,
    title: `Context · ${number.format(usage.used)} / ${number.format(usage.size)} tokens${cost}`,
    tone,
  };
}
