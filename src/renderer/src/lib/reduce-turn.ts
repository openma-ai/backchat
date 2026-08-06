import {
  parseAcpEvent as parseCommonAcpEvent,
  reduceTurn as reduceCommonTurn,
} from "@openma/common/session-events/acp";

export * from "@openma/common/session-events/acp";

type UnknownRecord = Record<string, unknown>;

type ProjectedPlanEntry = {
  id?: string;
  content: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "high" | "medium" | "low";
};

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function canonicalData(event: unknown): UnknownRecord | undefined {
  const envelope = record(event);
  if (
    envelope?.schema !== "oma.event.v1"
    && envelope?.schema_version !== "oma.event.v1"
  ) return undefined;
  if (typeof envelope.type !== "string") return undefined;
  return record(envelope.data) ?? {};
}

function textValue(data: UnknownRecord): string | undefined {
  if (typeof data.text === "string") return data.text;
  if (typeof data.content === "string") return data.content;
  const content = record(data.content);
  return typeof content?.text === "string" ? content.text : undefined;
}

function projectedPlanEntries(value: unknown): ProjectedPlanEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = record(item);
    if (!entry || typeof entry.content !== "string" || !entry.content.trim()) {
      return [];
    }
    const status =
      entry.status === "pending"
      || entry.status === "in_progress"
      || entry.status === "completed"
      || entry.status === "cancelled"
        ? entry.status
        : undefined;
    const priority =
      entry.priority === "high"
      || entry.priority === "medium"
      || entry.priority === "low"
        ? entry.priority
        : undefined;
    return [{
      ...(typeof entry.id === "string" && entry.id ? { id: entry.id } : {}),
      content: entry.content,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
    }];
  });
}

function mergeProjectedPlanEntries(
  current: ProjectedPlanEntry[],
  updates: ProjectedPlanEntry[],
): ProjectedPlanEntry[] {
  const next = [...current];
  for (const update of updates) {
    const index = update.id
      ? next.findIndex((entry) => entry.id === update.id)
      : -1;
    if (index === -1) next.push(update);
    else next[index] = { ...next[index], ...update };
  }
  return next;
}

/**
 * Project the stable OpenMA event envelope onto the ACP presentation shape
 * understood by the renderer reducer bundled in @openma/common v0.4.0.
 *
 * The host deliberately sends both the canonical envelope and the raw ACP
 * payload. Canonical facts remain authoritative for replay and adapter
 * convergence, so the renderer must not silently drop them merely because
 * the currently pinned reducer predates the envelope schema.
 */
function projectCanonicalEvent(event: unknown): unknown {
  const envelope = record(event);
  const data = canonicalData(event);
  if (!envelope || !data || typeof envelope.type !== "string") return event;

  const messageId = typeof data.message_id === "string"
    ? data.message_id
    : undefined;
  const adapterMeta = record(data.adapter_meta);
  if (envelope.type === "agent.message" || envelope.type === "agent.message_chunk") {
    const text = textValue(data);
    return text
      ? {
          type: "text",
          text,
          ...(messageId ? { messageId } : {}),
          ...(typeof data.phase === "string"
            ? { _meta: { codex: { phase: data.phase } } }
            : adapterMeta ? { _meta: adapterMeta } : {}),
        }
      : event;
  }
  if (envelope.type === "agent.thinking") {
    const text = textValue(data);
    return text
      ? {
          type: "thought",
          text,
          ...(messageId ? { messageId } : {}),
          ...(adapterMeta ? { _meta: adapterMeta } : {}),
        }
      : event;
  }

  if (
    envelope.type === "tool.started"
    || envelope.type === "tool.progress"
    || envelope.type === "tool.completed"
    || envelope.type === "tool.failed"
    || envelope.type === "tool.cancelled"
  ) {
    const toolCallId = data.tool_call_id ?? data.toolCallId ?? envelope.parent_id;
    if (typeof toolCallId !== "string" || !toolCallId) return event;
    const output = record(data.output);
    const rawOutput = data.raw_output
      ?? data.rawOutput
      ?? (typeof output?.data === "string" ? output.data : undefined)
      ?? data.error
      ?? data.reason;
    const status = typeof data.status === "string"
      ? data.status
      : envelope.type === "tool.started"
        ? "pending"
        : envelope.type === "tool.progress"
          ? "in_progress"
          : envelope.type === "tool.completed"
            ? "completed"
            : envelope.type === "tool.cancelled"
              ? "cancelled"
              : "failed";
    return {
      sessionUpdate: envelope.type === "tool.started" ? "tool_call" : "tool_call_update",
      toolCallId,
      status,
      ...(typeof data.title === "string" ? { title: data.title } : {}),
      ...(typeof data.kind === "string" ? { kind: data.kind } : {}),
      ...(typeof data.tool_name === "string" ? { toolName: data.tool_name } : {}),
      ...(data.raw_input !== undefined ? { rawInput: data.raw_input } : {}),
      ...(rawOutput !== undefined ? { rawOutput } : {}),
      ...(Array.isArray(data.content) ? { content: data.content } : {}),
      ...(Array.isArray(data.locations) ? { locations: data.locations } : {}),
      ...(adapterMeta ? { _meta: adapterMeta } : {}),
    };
  }

  if (envelope.type === "plan.updated" || envelope.type === "plan.completed") {
    const representation = data.representation;
    if (representation === "markdown" && record(data.document)) {
      const document = record(data.document)!;
      return {
        sessionUpdate: "plan_update",
        plan: {
          id: document.id ?? data.plan_id,
          title: document.title,
          content: { markdown: document.markdown },
        },
      };
    }
    return {
      sessionUpdate: "plan",
      entries: Array.isArray(data.entries) ? data.entries : [],
    };
  }
  if (envelope.type === "plan.removed") {
    return {
      sessionUpdate: "plan_removed",
      planId: data.plan_id,
    };
  }
  return event;
}

export function parseAcpEvent(event: unknown): ReturnType<typeof parseCommonAcpEvent> {
  return parseCommonAcpEvent(projectCanonicalEvent(event));
}

export function reduceTurn(
  events: Parameters<typeof reduceCommonTurn>[0],
): Omit<ReturnType<typeof reduceCommonTurn>, "plan"> & {
  plan: ProjectedPlanEntry[];
  planDocument?: { id?: string; title?: string; markdown?: string; uri?: string };
} {
  const outputByTool = new Map<string, string>();
  let canonicalPlanEntries: ProjectedPlanEntry[] | undefined;
  let canonicalPlanId: string | undefined;
  let planDocument:
    | { id?: string; title?: string; markdown?: string; uri?: string }
    | undefined;
  const projected = events.map((entry) => {
    const envelope = record(entry.payload);
    const data = canonicalData(entry.payload);
    if (
      envelope?.type === "plan.updated"
      || envelope?.type === "plan.completed"
    ) {
      const planId = typeof data?.plan_id === "string" ? data.plan_id : undefined;
      const entries = projectedPlanEntries(data?.entries);
      if (Array.isArray(data?.entries)) {
        canonicalPlanId = planId ?? canonicalPlanId;
        canonicalPlanEntries = data?.update_mode === "merge"
          ? mergeProjectedPlanEntries(canonicalPlanEntries ?? [], entries)
          : entries;
      }
      const document = record(data?.document);
      if (document) {
        const id = typeof document.id === "string"
          ? document.id
          : typeof data?.plan_id === "string" ? data.plan_id : undefined;
        planDocument = {
          ...(id ? { id } : {}),
          ...(typeof document.title === "string" ? { title: document.title } : {}),
          ...(typeof document.markdown === "string"
            ? { markdown: document.markdown }
            : {}),
          ...(typeof document.uri === "string" ? { uri: document.uri } : {}),
        };
      }
    } else if (envelope?.type === "plan.removed") {
      const removedId = typeof data?.plan_id === "string" ? data.plan_id : undefined;
      if (!removedId || removedId === planDocument?.id) {
        planDocument = undefined;
      }
      if (!removedId || removedId === canonicalPlanId) {
        canonicalPlanEntries = [];
        canonicalPlanId = undefined;
      }
    } else if (!data) {
      const raw = record(envelope?.update) ?? envelope;
      const updateType = raw?.sessionUpdate ?? raw?.session_update;
      if (updateType === "plan" || updateType === "plan_update") {
        const plan = record(raw?.plan) ?? raw;
        const content = record(plan?.content);
        const rawEntries = Array.isArray(raw?.entries)
          ? raw.entries
          : Array.isArray(plan?.entries)
            ? plan.entries
            : Array.isArray(content?.entries)
              ? content.entries
              : undefined;
        if (rawEntries) {
          const planId =
            typeof plan?.planId === "string" ? plan.planId
              : typeof plan?.plan_id === "string" ? plan.plan_id
                : typeof plan?.id === "string" ? plan.id
                  : undefined;
          const updateMode = plan?.updateMode ?? plan?.update_mode
            ?? raw?.updateMode ?? raw?.update_mode;
          const entries = projectedPlanEntries(rawEntries);
          canonicalPlanId = planId ?? canonicalPlanId;
          canonicalPlanEntries = updateMode === "merge"
            ? mergeProjectedPlanEntries(canonicalPlanEntries ?? [], entries)
            : entries;
        }
      } else if (updateType === "plan_removed") {
        const removedId =
          typeof raw?.planId === "string" ? raw.planId
            : typeof raw?.plan_id === "string" ? raw.plan_id
              : typeof raw?.id === "string" ? raw.id
                : undefined;
        if (!removedId || removedId === canonicalPlanId) {
          canonicalPlanEntries = [];
          canonicalPlanId = undefined;
        }
      }
    }
    const rawEnvelope = record(envelope?.update) ?? envelope;
    const isPlanRemoval = envelope?.type === "plan.removed"
      || (!data && (
        rawEnvelope?.sessionUpdate === "plan_removed"
        || rawEnvelope?.session_update === "plan_removed"
      ));
    // Plan removal is a structural state transition, not transcript prose.
    // The pinned common reducer renders unknown plan-removal shapes as a
    // generic note, so feed it a silent session update after the local plan
    // tracker has applied the id-aware removal above.
    const payload = isPlanRemoval
      ? { sessionUpdate: "session_info_update" }
      : projectCanonicalEvent(entry.payload);
    if (
      envelope
      && data
      && typeof envelope.type === "string"
      && envelope.type.startsWith("tool.")
    ) {
      const toolCallId = data.tool_call_id ?? data.toolCallId ?? envelope.parent_id;
      const output = record(data.output);
      const projectedPayload = record(payload);
      if (
        typeof toolCallId === "string"
        && typeof output?.data === "string"
        && projectedPayload
      ) {
        const next = output.append === true
          ? `${outputByTool.get(toolCallId) ?? ""}${output.data}`
          : output.data;
        outputByTool.set(toolCallId, next);
        return {
          ...entry,
          payload: { ...projectedPayload, rawOutput: next },
        };
      }
    }
    return { ...entry, payload };
  }) as Parameters<typeof reduceCommonTurn>[0];
  const reduced = reduceCommonTurn(projected);
  return {
    ...reduced,
    plan: canonicalPlanEntries ?? reduced.plan,
    ...(planDocument ? { planDocument } : {}),
  };
}
