import {
  parseAcpEvent,
  reduceTurn,
  type PlanEntry,
  type TurnRender,
} from "./reduce-turn";
import type { Turn } from "./session-types";

export interface PlanDocumentPresentation {
  id?: string;
  sourceToolCallId?: string;
  title?: string;
  markdown: string;
  uri?: string;
}

export interface TaskListEntry {
  content: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "high" | "medium" | "low";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Find the latest full plan snapshot emitted by an agent. ACP plan updates
 * replace the complete list, including an empty list that clears a previous
 * plan. */
type TurnProjector = (turn: Turn) => TurnRender;

export function latestPlanForTurns(
  turns: readonly Turn[],
  projectTurn?: TurnProjector,
): PlanEntry[] {
  return latestStandardPlanSnapshot(turns, projectTurn)?.entries ?? [];
}

function latestStandardPlanSnapshot(
  turns: readonly Turn[],
  projectTurn: TurnProjector = (turn) => reduceTurn(turn.events),
): { entries: PlanEntry[] } | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const rendered = projectTurn(turns[index]!);
    if (rendered.hasPlanLifecycle) return { entries: rendered.plan };
  }
  return undefined;
}

/** Project provider-neutral ACP/OpenMA Plan snapshots into the shared
 * task-list presentation. Harness-specific tool metadata is normalized by
 * runtime adapters before it reaches this GUI boundary. */
export function latestTaskListForTurns(
  _agentId: string | undefined,
  turns: readonly Turn[],
  projectTurn?: TurnProjector,
): TaskListEntry[] {
  const standardPlan = latestStandardPlanSnapshot(turns, projectTurn);
  if (standardPlan) {
    return standardPlan.entries.map((entry) => ({
      content: entry.content,
      status: entry.status,
      priority: entry.priority,
    }));
  }

  return [];
}

export function latestPlanDocumentForRender(
  rendered: TurnRender,
  agentId?: string,
): PlanDocumentPresentation | undefined {
  const document = rendered.planDocument;
  if (document?.markdown) {
    return {
      ...(document.id ? { id: document.id } : {}),
      ...(document.title ? { title: document.title } : {}),
      markdown: document.markdown,
    };
  }
  if (document?.uri) {
    return {
      ...(document.id ? { id: document.id } : {}),
      title: document.title ?? "Plan file",
      markdown: `[Open plan file](${document.uri})`,
      uri: document.uri,
    };
  }
  if (agentId !== "claude-acp") return undefined;
  for (let index = rendered.tools.length - 1; index >= 0; index -= 1) {
    const tool = rendered.tools[index]!;
    if (tool.toolName !== "ExitPlanMode") continue;
    const input = isRecord(tool.rawInput) ? tool.rawInput : {};
    if (typeof input.plan !== "string") continue;
    return {
      id: tool.toolCallId,
      sourceToolCallId: tool.toolCallId,
      title: markdownTitle(input.plan) ?? "Plan",
      markdown: input.plan,
    };
  }
  return undefined;
}

/** Compatibility adapter for plan-document events used by one-shot callers. */
export function latestPlanDocumentForEvents(
  events: readonly { payload: unknown }[],
  agentId?: string,
): PlanDocumentPresentation | undefined {
  const removedPlanIds = new Set<string>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const canonical = canonicalPlanEnvelope(events[index]?.payload);
    if (canonical?.type === "plan.removed") {
      const planId = planIdFrom(canonical.data);
      if (!planId) return undefined;
      removedPlanIds.add(planId);
      continue;
    }
    if (
      canonical?.type === "plan.updated"
      || canonical?.type === "plan.completed"
    ) {
      const document = canonical.data.document
        && typeof canonical.data.document === "object"
          ? canonical.data.document as Record<string, unknown>
          : undefined;
      const planId = planIdFrom(canonical.data) ?? (document ? planIdFrom(document) : undefined);
      if (planId && removedPlanIds.has(planId)) continue;
      if (document && typeof document.markdown === "string") {
        return {
          ...(planId ? { id: planId } : {}),
          ...(typeof document.title === "string" ? { title: document.title } : {}),
          markdown: document.markdown,
        };
      }
      if (document && typeof document.uri === "string") {
        return {
          ...(planId ? { id: planId } : {}),
          title: typeof document.title === "string" ? document.title : "Plan file",
          markdown: `[Open plan file](${document.uri})`,
          uri: document.uri,
        };
      }
    }

    const parsed = parseAcpEvent(events[index]?.payload);
    if (parsed.kind === "plan_removed") {
      if (!parsed.planId) return undefined;
      removedPlanIds.add(parsed.planId);
      continue;
    }
    const parsedDocument = parsed.kind === "plan"
      ? parsed.document
      : parsed.kind === "plan_document"
        ? parsed.document
        : undefined;
    const parsedPlanId = parsed.kind === "plan" ? parsed.planId : parsedDocument?.id;
    if (parsedDocument && (!parsedPlanId || !removedPlanIds.has(parsedPlanId))) {
      if (parsedDocument.markdown) {
        return {
          ...(parsedPlanId ? { id: parsedPlanId } : {}),
          ...(parsedDocument.title ? { title: parsedDocument.title } : {}),
          markdown: parsedDocument.markdown,
        };
      }
      if (parsedDocument.uri) {
        return {
          ...(parsedPlanId ? { id: parsedPlanId } : {}),
          title: parsedDocument.title ?? "Plan file",
          markdown: `[Open plan file](${parsedDocument.uri})`,
          uri: parsedDocument.uri,
        };
      }
    }

    const raw = unwrapSessionUpdate(events[index]?.payload);
    if (!raw) continue;
    if (raw.sessionUpdate === "plan_removed") {
      const planId = planIdFrom(raw);
      if (!planId) return undefined;
      removedPlanIds.add(planId);
      continue;
    }
    if (raw.sessionUpdate === "plan_update") {
      const plan =
        raw.plan && typeof raw.plan === "object"
          ? (raw.plan as Record<string, unknown>)
          : raw;
      const planId = planIdFrom(plan);
      if (planId && removedPlanIds.has(planId)) continue;
      const content =
        plan.content && typeof plan.content === "object"
          ? (plan.content as Record<string, unknown>)
          : plan;
      const markdown =
        typeof content.markdown === "string"
          ? content.markdown
          : typeof content.content === "string"
            ? content.content
            : undefined;
      if (markdown) {
        return {
          ...(planId ? { id: planId } : {}),
          ...(typeof plan.title === "string" ? { title: plan.title } : {}),
          markdown,
        };
      }
      const uri =
        typeof plan.uri === "string"
          ? plan.uri
          : typeof content.uri === "string"
            ? content.uri
            : undefined;
      if (uri) {
        return {
          ...(planId ? { id: planId } : {}),
          title: typeof plan.title === "string" ? plan.title : "Plan file",
          markdown: `[Open plan file](${uri})`,
          uri,
        };
      }
      continue;
    }

    if (agentId !== "claude-acp") continue;
    if (parsed.kind !== "tool_call") continue;
    if (parsed.tool.toolName !== "ExitPlanMode") continue;
    const input =
      parsed.tool.rawInput && typeof parsed.tool.rawInput === "object"
        ? (parsed.tool.rawInput as Record<string, unknown>)
        : undefined;
    if (typeof input?.plan !== "string" || input.plan.trim().length === 0) {
      continue;
    }
    const heading = input.plan.match(/^\s*#\s+(.+?)\s*$/m)?.[1];
    return {
      id: parsed.tool.toolCallId,
      sourceToolCallId: parsed.tool.toolCallId,
      title: heading ?? "Implementation plan",
      markdown: input.plan,
    };
  }
  return undefined;
}

function canonicalPlanEnvelope(value: unknown): {
  type: "plan.updated" | "plan.completed" | "plan.removed";
  data: Record<string, unknown>;
} | undefined {
  if (!value || typeof value !== "object") return undefined;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.schema !== "oma.event.v1"
    && envelope.schema_version !== "oma.event.v1"
  ) return undefined;
  if (
    envelope.type !== "plan.updated"
    && envelope.type !== "plan.completed"
    && envelope.type !== "plan.removed"
  ) return undefined;
  return {
    type: envelope.type,
    data: envelope.data && typeof envelope.data === "object"
      ? envelope.data as Record<string, unknown>
      : {},
  };
}

function planIdFrom(value: Record<string, unknown>): string | undefined {
  const candidate = value.planId ?? value.plan_id ?? value.id;
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}

function markdownTitle(markdown: string): string | undefined {
  return markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1];
}

function unwrapSessionUpdate(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return record.update && typeof record.update === "object"
    ? (record.update as Record<string, unknown>)
    : record;
}
