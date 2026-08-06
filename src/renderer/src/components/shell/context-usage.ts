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

export function sessionRuntimeStatusPresentation(status: string): {
  label: string;
  state: string;
} {
  switch (status) {
    case "running":
    case "starting":
      return { label: "Running", state: "running" };
    case "disposed":
      return { label: "Terminated", state: "terminated" };
    case "errored":
      return { label: "Error", state: "error" };
    case "draft":
      return { label: "Draft", state: "draft" };
    default:
      return { label: "Idle", state: "idle" };
  }
}

/** Flatten the negotiated ACP capability tree into literal, inspectable
 * labels. False/null leaves are intentionally omitted; an empty object is a
 * positive marker in the ACP schema and therefore remains visible. */
export function visibleCapabilityLabels(capabilities: unknown): string[] {
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return [];
  }

  const labels: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (value === true) {
      labels.push(path);
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      labels.push(path);
      return;
    }
    for (const [key, nested] of entries) {
      visit(nested, path ? `${path}.${key}` : key);
    }
  };

  for (const [key, value] of Object.entries(capabilities as Record<string, unknown>)) {
    visit(value, key);
  }
  return labels;
}
