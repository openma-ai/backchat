import {
  findSelectConfigOption,
  type AcpSessionConfigOption,
} from "./session-config-options";
import type { AcpAvailableCommand } from "./session-store";

export function slashCommandQuery(text: string): string | null {
  if (!text.startsWith("/")) return null;
  const match = /^\/([^\s]*)$/.exec(text);
  return match ? (match[1] ?? "") : null;
}

export function normalizeAgentAvailableCommands(
  value: unknown,
): AcpAvailableCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const command = candidate as Record<string, unknown>;
    if (typeof command.name !== "string" || !command.name.trim()) return [];
    const input = command.input && typeof command.input === "object"
      ? command.input as Record<string, unknown>
      : null;
    return [{
      name: command.name.trim(),
      ...(typeof command.description === "string"
        ? { description: command.description }
        : {}),
      ...(input
        ? {
            input: {
              ...(typeof input.hint === "string" ? { hint: input.hint } : {}),
            },
          }
        : {}),
      ...(typeof command.kind === "string" ? { kind: command.kind } : {}),
      ...(typeof command.type === "string" ? { type: command.type } : {}),
      ...(typeof command.category === "string" ? { category: command.category } : {}),
      ...(typeof command.source === "string" ? { source: command.source } : {}),
      ...(command.metadata && typeof command.metadata === "object"
        ? { metadata: command.metadata as Record<string, unknown> }
        : {}),
    }];
  });
}

/** The host-owned `/plan` contract for Codex — shared by the synthesized
 * catalogue entry and the composer's last-gate submit interception, so a
 * slow agent catalogue can never let the literal text escape as a prompt. */
export const HOST_PLAN_COMMAND: AcpAvailableCommand = {
  name: "plan",
  description: "Enter plan mode for this session",
  kind: "session-state",
  metadata: {
    commandAction: {
      kind: "setConfigOption",
      configId: "collaboration_mode",
      value: "plan",
      resetValue: "default",
    },
  },
};

export function withSessionStateCommands(
  commands: readonly AcpAvailableCommand[],
  configOptions: readonly AcpSessionConfigOption[] | undefined,
  agentId: string,
  options?: { assumePlanCapable?: boolean },
): AcpAvailableCommand[] {
  // Drafts have no session config catalogue yet; modern Codex always
  // supports the collaboration switch, so the host still owns `/plan`
  // there and the picked value rides along as a draft config override.
  const hasPlanMode = agentId === "codex-acp"
    && (Boolean(options?.assumePlanCapable)
      || Boolean(findSelectConfigOption(configOptions, "collaboration_mode")));
  if (!hasPlanMode || commands.some((command) => command.name === "plan")) {
    return [...commands];
  }
  return [HOST_PLAN_COMMAND, ...commands];
}

export interface SlashCommandConfigAction {
  configId: string;
  value: string | boolean;
  resetValue?: string | boolean;
}

/** Codex marks session-state commands (`/plan`) with `_meta.commandAction`.
 * Such a command is a local config switch: the client applies the config
 * value and never submits the command text as a prompt. The same shape on
 * `metadata` covers host-synthesized commands. */
export function slashCommandConfigAction(
  command: AcpAvailableCommand,
): SlashCommandConfigAction | undefined {
  const carriers = [
    command.metadata,
    (command as { _meta?: Record<string, unknown> })._meta,
  ];
  for (const carrier of carriers) {
    const action = carrier?.["commandAction"];
    if (!action || typeof action !== "object") continue;
    const record = action as Record<string, unknown>;
    if (record["kind"] !== "setConfigOption") continue;
    const configId = record["configId"];
    if (typeof configId !== "string" || !configId) continue;
    const value = record["value"];
    if (typeof value !== "string" && typeof value !== "boolean") continue;
    const resetValue = record["resetValue"];
    return {
      configId,
      value,
      ...(typeof resetValue === "string" || typeof resetValue === "boolean"
        ? { resetValue }
        : {}),
    };
  }
  return undefined;
}

export function withHostForkCommand(
  commands: readonly AcpAvailableCommand[],
  enabled: boolean,
  copy: { title: string; description: string },
): AcpAvailableCommand[] {
  if (!enabled) return [...commands];
  return [
    {
      name: "fork",
      description: copy.title,
      kind: "host-fork",
      source: "backchat",
      metadata: { description: copy.description },
    },
    ...commands.filter((command) => command.name.trim().toLowerCase() !== "fork"),
  ];
}

export function isHostForkSlashCommand(
  command: AcpAvailableCommand,
): boolean {
  return command.kind === "host-fork" && command.name === "fork";
}

export function matchesSlashCommand(
  commandName: string,
  query: string,
): boolean {
  if (!query) return true;
  const name = commandName.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  if (
    name.startsWith(normalizedQuery)
    || name.includes(normalizedQuery)
  ) {
    return true;
  }

  let cursor = 0;
  for (const character of normalizedQuery) {
    cursor = name.indexOf(character, cursor);
    if (cursor === -1) return false;
    cursor += 1;
  }
  return true;
}

export function isSkillSlashCommand(
  command: AcpAvailableCommand,
): boolean {
  // Codex publishes installed skills as `$skill-name`; other adapters use
  // `skill:` / `skill/` or structured metadata. Treat all of those as the
  // same semantic category instead of relying on description copy.
  if (/^(?:skill[:/]|\$)/i.test(command.name)) return true;
  const metadata = command.metadata ?? {};
  const markers = [
    command.kind,
    command.type,
    command.category,
    command.source,
    metadata["kind"],
    metadata["type"],
    metadata["category"],
    metadata["source"],
  ];
  if (
    markers.some((value) => {
      if (typeof value !== "string") return false;
      const normalized = value.toLowerCase();
      return normalized === "skill" || normalized === "skills";
    })
  ) {
    return true;
  }

  const description = command.description?.trim().toLowerCase() ?? "";
  return /^\[?skill[:\]\s-]/.test(description);
}

export interface SlashCommandSection {
  kind: "commands" | "skills";
  commands: AcpAvailableCommand[];
  hiddenCount: number;
}

export function buildSlashCommandSections(
  commands: readonly AcpAvailableCommand[],
  query: string,
  skillPreviewLimit = 5,
): SlashCommandSection[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = commands.filter((command) =>
    matchesSlashCommand(command.name, normalizedQuery),
  );
  const nativeCommands = matches.filter(
    (command) => !isSkillSlashCommand(command),
  );
  const skills = matches.filter(isSkillSlashCommand);
  const visibleSkills = normalizedQuery
    ? skills
    : skills.slice(0, skillPreviewLimit);
  return [
    ...(nativeCommands.length > 0
      ? [{
          kind: "commands" as const,
          commands: nativeCommands,
          hiddenCount: 0,
        }]
      : []),
    ...(visibleSkills.length > 0
      ? [{
          kind: "skills" as const,
          commands: visibleSkills,
          hiddenCount: normalizedQuery
            ? 0
            : skills.length - visibleSkills.length,
        }]
      : []),
  ];
}

export function skillCommandLabel(command: AcpAvailableCommand): string {
  const name = command.name.replace(/^(?:skill[:/]|\$)/i, "");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}
