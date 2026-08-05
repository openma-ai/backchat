import type {
  OpenMAEvent,
  WorkItemSnapshot,
} from "@openma/common/session-events/openma";

import {
  latestTaskListForTurns,
  type TaskListEntry,
} from "./session-plan";
import type { Turn } from "./session-types";

export interface ComposerActivityLabels {
  plan: string;
  monitor: string;
  background: string;
  running: string;
  completed: string;
  event: string;
  events: string;
}

export interface ComposerActivityItem {
  id: string;
  label: string;
  status: string;
  detail?: string;
  variant?: "subscription" | "event";
}

export interface ComposerActivityModule {
  id: string;
  kind: string;
  label: string;
  summary: string;
  items: ComposerActivityItem[];
}

export interface ComposerActivityInput {
  tasks: readonly TaskListEntry[];
  workItems: readonly WorkItemSnapshot[];
  openmaEvents: readonly OpenMAEvent[];
  labels: ComposerActivityLabels;
}

export interface ComposerSessionActivityInput
  extends Omit<ComposerActivityInput, "tasks"> {
  agentId?: string;
  turns: readonly Turn[];
}

export function composerActivityModulesForSession(
  input: ComposerSessionActivityInput,
): ComposerActivityModule[] {
  return composerActivityModules({
    tasks: latestTaskListForTurns(input.agentId, input.turns),
    workItems: input.workItems,
    openmaEvents: input.openmaEvents,
    labels: input.labels,
  });
}

export function composerActivityModules(
  input: ComposerActivityInput,
): ComposerActivityModule[] {
  const modules: ComposerActivityModule[] = [];
  if (input.tasks.length > 0) {
    const completed = input.tasks.filter(
      (task) => task.status === "completed",
    ).length;
    modules.push({
      id: "plan",
      kind: "plan",
      label: input.labels.plan,
      summary: `${completed} / ${input.tasks.length}`,
      items: input.tasks.map((task, index) => ({
        id: `plan:${index}`,
        label: task.content,
        status: task.status ?? "pending",
      })),
    });
  }

  const monitors = input.workItems.filter((item) => item.kind === "monitor");
  const monitorEvents = input.openmaEvents.flatMap((event) => {
    if (event.type !== "monitor.event" || !isRecord(event.data)) return [];
    const description = stringValue(event.data.description);
    const text = stringValue(event.data.text);
    if (!description || !text) return [];
    return [{ event, description, text }];
  });
  if (monitors.length > 0 || monitorEvents.length > 0) {
    const monitorSummary = summarizeMonitorActivity(
      monitors,
      monitorEvents.length,
      input.labels,
    );
    modules.push({
      id: "monitor",
      kind: "monitor",
      label: input.labels.monitor,
      summary: monitorSummary,
      items: [
        ...monitors.map((item) => ({
          id: item.id,
          label: item.title ?? item.id,
          status: item.status,
          variant: "subscription" as const,
        })),
        ...monitorEvents.map(({ event, description, text }) => ({
          id: `monitor:event:${event.event_id}`,
          label: description,
          status: "event",
          detail: text,
          variant: "event" as const,
        })),
      ],
    });
  }

  const background = input.workItems.filter((item) => item.kind !== "monitor");
  if (background.length > 0) {
    modules.push({
      id: "background",
      kind: "background",
      label: input.labels.background,
      summary: summarizeStatuses(background, input.labels),
      items: background.map((item) => ({
        id: item.id,
        label: item.title ?? item.id,
        status: item.status,
      })),
    });
  }
  return modules;
}

function summarizeMonitorActivity(
  monitors: readonly WorkItemSnapshot[],
  eventCount: number,
  labels: ComposerActivityLabels,
): string {
  const parts: string[] = [];
  if (monitors.length > 0) parts.push(summarizeStatuses(monitors, labels));
  if (eventCount > 0) {
    parts.push(`${eventCount} ${eventCount === 1 ? labels.event : labels.events}`);
  }
  return parts.join(" · ");
}

function summarizeStatuses(
  items: readonly WorkItemSnapshot[],
  labels: ComposerActivityLabels,
): string {
  const running = items.filter((item) => item.status === "running").length;
  if (running > 0) return `${running} ${labels.running}`;
  const completed = items.filter((item) => item.status === "completed").length;
  if (completed === items.length) return `${completed} ${labels.completed}`;
  return String(items.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
