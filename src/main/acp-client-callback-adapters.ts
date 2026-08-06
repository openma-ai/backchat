import type { ClientCallbacks } from "@open-managed-agents-desktop/acp";
import type {
  ElicitationFieldInfo,
  ElicitationFormRequestInfo,
  ElicitationFormResponseInfo,
  ElicitationUrlRequestInfo,
  ElicitationUrlResponseInfo,
  PermissionAskInfo,
} from "../shared/api.js";

type CreateElicitationResponse = Awaited<ReturnType<
  NonNullable<ClientCallbacks["createElicitation"]>
>>;
type AcceptedElicitationResponse = Extract<
  CreateElicitationResponse,
  { action: "accept" }
>;
type ElicitationContentValue = NonNullable<
  AcceptedElicitationResponse["content"]
>[string];

/** Normalize the display fields of an ACP permission callback before the
 * request crosses into the renderer. Provider metadata remains callback/raw
 * evidence and never becomes a GUI parsing contract. */
export function permissionPresentationForHarness(
  agentId: string | undefined,
  toolCall: unknown,
): PermissionAskInfo["presentation"] {
  const tool = recordValue(toolCall);
  const rawInput = recordValue(tool.rawInput ?? tool.raw_input);
  const normalizedAgentId = agentId?.trim().toLowerCase() ?? "";
  const codexParams = normalizedAgentId === "codex-acp"
    || normalizedAgentId.includes("codex")
    ? recordValue(recordValue(recordValue(tool._meta).codex).params)
    : {};
  const kind = stringValue(tool.kind);
  const reason = stringValue(codexParams.reason) ?? stringValue(rawInput.reason);
  const command =
    stringValue(codexParams.command)
    ?? stringValue(rawInput.command)
    ?? stringValue(rawInput.cmd);
  return {
    title:
      stringValue(tool.title)
      ?? stringValue(codexParams.title)
      ?? "Approve this action?",
    ...(kind ? { kind } : {}),
    ...(reason ? { reason } : {}),
    ...(command ? { command } : {}),
  };
}

export interface ElicitationCallbackOptions {
  sessionId: string;
  requestPermission?: ClientCallbacks["requestPermission"];
  requestForm?: (
    request: ElicitationFormRequestInfo,
  ) => Promise<ElicitationFormResponseInfo>;
  requestUrl?: (
    request: ElicitationUrlRequestInfo,
  ) => Promise<ElicitationUrlResponseInfo>;
}

/** Reuse the existing typed ask slot for ACP form and URL elicitation. Fields
 * outside the supported schema are declined instead of inventing values. */
export function elicitationCallbackForSession(
  options: ElicitationCallbackOptions,
): ClientCallbacks["createElicitation"] | undefined {
  const requestPermission = options.requestPermission;
  if (!requestPermission && !options.requestForm && !options.requestUrl) return undefined;

  return async (params) => {
    if (params.mode === "url") {
      if (!options.requestUrl) return { action: "decline" };
      const elicitationId = stringValue(params.elicitationId);
      const url = safeElicitationUrl(params.url);
      if (!elicitationId || !url) return { action: "decline" };
      return options.requestUrl({
        sessionId: options.sessionId,
        message: params.message,
        elicitationId,
        url,
      });
    }
    if (params.mode !== "form") return { action: "decline" };
    const schema = recordValue(params.requestedSchema);
    const properties = recordValue(schema.properties);
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((value): value is string => typeof value === "string")
        : [],
    );
    if (options.requestForm) {
      const fields = normalizeElicitationFields(properties, required);
      if (!fields) return { action: "decline" };
      return options.requestForm({
        sessionId: options.sessionId,
        message: params.message,
        fields,
      });
    }

    if (!requestPermission) return { action: "decline" };
    const content: Record<string, ElicitationContentValue> = {};

    for (const [name, rawProperty] of Object.entries(properties)) {
      const property = recordValue(rawProperty);
      const choices = elicitationChoices(property);
      if (choices.length === 0) {
        if (required.has(name)) return { action: "decline" };
        continue;
      }

      const title = stringValue(property.title) ?? name;
      const prompt = stringValue(property.description) ?? title;
      const selected = property.type === "array"
        ? await selectMany({
            requestPermission,
            sessionId: options.sessionId,
            name,
            title: `${params.message}: ${title}`,
            prompt,
            choices,
            minItems: numberValue(property.minItems) ?? (required.has(name) ? 1 : 0),
            maxItems: numberValue(property.maxItems) ?? choices.length,
          })
        : await selectOne({
            requestPermission,
            sessionId: options.sessionId,
            name,
            title: `${params.message}: ${title}`,
            prompt,
            choices,
            required: required.has(name),
          });
      if (selected.action !== "accept") return { action: selected.action };
      if (selected.value !== undefined) content[name] = selected.value;
    }

    return { action: "accept", content };
  };
}

function normalizeElicitationFields(
  properties: Record<string, unknown>,
  required: ReadonlySet<string>,
): ElicitationFieldInfo[] | null {
  const fields: ElicitationFieldInfo[] = [];
  for (const [name, rawProperty] of Object.entries(properties)) {
    const property = recordValue(rawProperty);
    const title = stringValue(property.title) ?? name;
    const description = stringValue(property.description);
    const base = {
      name,
      title,
      ...(description ? { description } : {}),
      required: required.has(name),
    };
    const choices = elicitationChoices(property);
    if (property.type === "string" && choices.length > 0) {
      fields.push({
        ...base,
        type: "select",
        options: choices.map((choice) => ({ value: choice.id, label: choice.label })),
        ...(typeof property.default === "string"
          ? { defaultValue: property.default }
          : {}),
      });
      continue;
    }
    if (property.type === "string") {
      const format = property.format === "email"
        || property.format === "uri"
        || property.format === "date"
        || property.format === "date-time"
        ? property.format
        : undefined;
      fields.push({
        ...base,
        type: "text",
        ...(numberValue(property.minLength) !== undefined
          ? { minLength: numberValue(property.minLength) }
          : {}),
        ...(numberValue(property.maxLength) !== undefined
          ? { maxLength: numberValue(property.maxLength) }
          : {}),
        ...(typeof property.pattern === "string"
          ? { pattern: property.pattern }
          : {}),
        ...(format ? { format } : {}),
        ...(typeof property.default === "string"
          ? { defaultValue: property.default }
          : {}),
      });
      continue;
    }
    if (property.type === "number" || property.type === "integer") {
      fields.push({
        ...base,
        type: "number",
        integer: property.type === "integer",
        ...(finiteNumber(property.minimum) !== undefined
          ? { minimum: finiteNumber(property.minimum) }
          : {}),
        ...(finiteNumber(property.maximum) !== undefined
          ? { maximum: finiteNumber(property.maximum) }
          : {}),
        ...(finiteNumber(property.default) !== undefined
          ? { defaultValue: finiteNumber(property.default) }
          : {}),
      });
      continue;
    }
    if (property.type === "boolean") {
      fields.push({
        ...base,
        type: "boolean",
        ...(typeof property.default === "boolean"
          ? { defaultValue: property.default }
          : {}),
      });
      continue;
    }
    if (property.type === "array" && choices.length > 0) {
      fields.push({
        ...base,
        type: "multiselect",
        options: choices.map((choice) => ({ value: choice.id, label: choice.label })),
        ...(numberValue(property.minItems) !== undefined
          ? { minItems: numberValue(property.minItems) }
          : {}),
        ...(numberValue(property.maxItems) !== undefined
          ? { maxItems: numberValue(property.maxItems) }
          : {}),
        ...(Array.isArray(property.default)
          ? {
              defaultValue: property.default.filter(
                (value): value is string => typeof value === "string",
              ),
            }
          : {}),
      });
      continue;
    }
    if (required.has(name)) return null;
  }
  return fields;
}

interface Choice {
  id: string;
  label: string;
}

function elicitationChoices(property: Record<string, unknown>): Choice[] {
  if (property.type === "boolean") {
    return [
      { id: "true", label: "Yes" },
      { id: "false", label: "No" },
    ];
  }
  if (property.type === "string") {
    return enumChoices(property.enum, property.oneOf);
  }
  if (property.type === "array") {
    const items = recordValue(property.items);
    return enumChoices(items.enum, items.anyOf);
  }
  return [];
}

function enumChoices(values: unknown, titled: unknown): Choice[] {
  if (Array.isArray(titled)) {
    return titled.flatMap((value) => {
      const option = recordValue(value);
      const id = stringValue(option.const);
      const label = stringValue(option.title);
      return id && label ? [{ id, label }] : [];
    });
  }
  return Array.isArray(values)
    ? values.flatMap((value) =>
        typeof value === "string" ? [{ id: value, label: value }] : [])
    : [];
}

async function selectOne(input: {
  requestPermission: NonNullable<ClientCallbacks["requestPermission"]>;
  sessionId: string;
  name: string;
  title: string;
  prompt: string;
  choices: Choice[];
  required: boolean;
}): Promise<{
  action: "accept" | "cancel" | "decline";
  value?: ElicitationContentValue;
}> {
  const skip = reservedOption("__openma_elicitation_skip__", input.choices);
  const response = await input.requestPermission({
    sessionId: input.sessionId,
    toolCall: elicitationToolCall(input.name, input.title, input.prompt),
    options: [
      ...input.choices.map((choice) => ({
        optionId: choice.id,
        name: choice.label,
        kind: "allow_once" as const,
      })),
      ...(!input.required
        ? [{ optionId: skip, name: "Skip", kind: "reject_once" as const }]
        : []),
    ],
  });
  const outcome = recordValue(response.outcome);
  if (outcome.outcome === "cancelled") return { action: "cancel" };
  const optionId = stringValue(outcome.optionId);
  if (!optionId || optionId === skip) return { action: "accept" };
  if (!input.choices.some((choice) => choice.id === optionId)) {
    return { action: "decline" };
  }
  return {
    action: "accept",
    value: input.choices.length === 2
      && input.choices[0]?.id === "true"
      && input.choices[1]?.id === "false"
        ? optionId === "true"
        : optionId,
  };
}

async function selectMany(input: {
  requestPermission: NonNullable<ClientCallbacks["requestPermission"]>;
  sessionId: string;
  name: string;
  title: string;
  prompt: string;
  choices: Choice[];
  minItems: number;
  maxItems: number;
}): Promise<{ action: "accept" | "cancel" | "decline"; value?: string[] }> {
  const selected: string[] = [];
  const done = reservedOption("__openma_elicitation_done__", input.choices);
  const maxItems = Math.max(0, Math.min(input.maxItems, input.choices.length));
  while (selected.length < maxItems) {
    const remaining = input.choices.filter((choice) => !selected.includes(choice.id));
    const response = await input.requestPermission({
      sessionId: input.sessionId,
      toolCall: elicitationToolCall(
        `${input.name}:${selected.length}`,
        input.title,
        input.prompt,
      ),
      options: [
        ...remaining.map((choice) => ({
          optionId: choice.id,
          name: choice.label,
          kind: "allow_once" as const,
        })),
        ...(selected.length >= input.minItems
          ? [{ optionId: done, name: "Done selecting", kind: "reject_once" as const }]
          : []),
      ],
    });
    const outcome = recordValue(response.outcome);
    if (outcome.outcome === "cancelled") return { action: "cancel" };
    const optionId = stringValue(outcome.optionId);
    if (!optionId || optionId === done) break;
    if (!remaining.some((choice) => choice.id === optionId)) {
      return { action: "decline" };
    }
    selected.push(optionId);
  }
  return selected.length < input.minItems
    ? { action: "decline" }
    : { action: "accept", value: selected };
}

function elicitationToolCall(name: string, title: string, prompt: string) {
  return {
    toolCallId: `elicitation:${name}`,
    title,
    kind: "other" as const,
    status: "pending" as const,
    content: [{ type: "content" as const, content: { type: "text" as const, text: prompt } }],
  };
}

function reservedOption(seed: string, choices: Choice[]): string {
  let value = seed;
  while (choices.some((choice) => choice.id === value)) value += "_";
  return value;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeElicitationUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
