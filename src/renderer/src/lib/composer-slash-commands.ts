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

export function withSessionStateCommands(
  commands: readonly AcpAvailableCommand[],
  configOptions: readonly AcpSessionConfigOption[] | undefined,
  agentId: string,
): AcpAvailableCommand[] {
  const hasPlanMode = agentId === "codex-acp"
    && Boolean(findSelectConfigOption(configOptions, "collaboration_mode"));
  if (!hasPlanMode || commands.some((command) => command.name === "plan")) {
    return [...commands];
  }
  return [
    {
      name: "plan",
      description: "Enter plan mode for this session",
      kind: "session-state",
    },
    ...commands,
  ];
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
  if (/^skill[:/]/i.test(command.name)) return true;
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
  const name = command.name.replace(/^skill[:/]/i, "");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}
