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
      // `_meta` is where ACP puts implementation detail, and where Codex puts
      // the `/plan` config switch. Dropping it here turned `/plan` into an
      // ordinary command that escaped as a prompt from draft composers.
      ...(command._meta && typeof command._meta === "object"
        ? { _meta: command._meta as Record<string, unknown> }
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

/** Host knowledge about session-state commands, keyed by harness.
 *
 * ACP v1's `AvailableCommand` is only `name` / `description` / `input`, and
 * commands are invoked by putting their text in a `session/prompt` request.
 * `commandAction` is a codex-acp `_meta` extension, so a command name alone
 * proves nothing: the official slash-command docs even show a prompt-style
 * `/plan` that takes `input.hint`. Never infer this contract from a name —
 * add a harness here only with evidence from that adapter. */
const HOST_SESSION_STATE_COMMANDS: Readonly<
  Record<string, readonly AcpAvailableCommand[]>
> = {
  "codex-acp": [HOST_PLAN_COMMAND],
};

/** Codex's `/plan` contract is host-owned, so a catalogue entry that reached
 * us stripped of `_meta` (probe caches and snapshot normalizers whitelist
 * fields) is still a config switch and must never leave as a prompt. */
export function hostSessionStateAction(
  command: AcpAvailableCommand,
  agentId: string,
): SlashCommandConfigAction | undefined {
  const host = (HOST_SESSION_STATE_COMMANDS[agentId] ?? []).find(
    (candidate) => candidate.name === command.name,
  );
  // A host entry describes an argument-free switch; an entry carrying input
  // is the agent's own prompt command and must keep its prompt transport.
  if (!host || command.input) return undefined;
  return slashCommandConfigAction(host);
}

export function withSessionStateCommands(
  commands: readonly AcpAvailableCommand[],
  configOptions: readonly AcpSessionConfigOption[] | undefined,
  agentId: string,
  options?: { assumePlanCapable?: boolean },
): AcpAvailableCommand[] {
  let next = [...commands];
  for (const host of HOST_SESSION_STATE_COMMANDS[agentId] ?? []) {
    const action = slashCommandConfigAction(host);
    if (!action) continue;
    const existing = next.find((command) => command.name === host.name);
    // An agent-published entry that still carries its own action owns itself.
    if (existing && slashCommandConfigAction(existing)) continue;
    // Drafts have no session config catalogue yet; modern Codex always
    // supports the collaboration switch, so the host still owns `/plan`
    // there and the picked value rides along as a draft config override.
    const capable = Boolean(options?.assumePlanCapable)
      || Boolean(findSelectConfigOption(configOptions, action.configId));
    if (!capable) continue;
    if (existing) {
      // Upgrade in place: leaving a stripped entry in the list is exactly how
      // `/plan` used to fall through the generic branch and get sent.
      next = next.map((command) =>
        command === existing
          ? {
              ...host,
              ...(command.description
                ? { description: command.description }
                : {}),
            }
          : command,
      );
      continue;
    }
    next = [host, ...next];
  }
  return next;
}

export interface SlashCommandConfigAction {
  configId: string;
  value: string | boolean;
  resetValue?: string | boolean;
}

/** Codex marks session-state commands with `_meta.commandAction`; ACP v1
 * itself has no such field, so this is read defensively. Only
 * `setConfigOption` is a local switch — `prefixPrompt` (Codex's `/goal`)
 * still travels as prompt text, which is how ACP invokes commands. */
export function slashCommandConfigAction(
  command: AcpAvailableCommand,
): SlashCommandConfigAction | undefined {
  const carriers = [command.metadata, command._meta];
  for (const carrier of carriers) {
    const action = carrier?.["commandAction"];
    if (!action || typeof action !== "object") continue;
    const record = action as Record<string, unknown>;
    switch (record["kind"]) {
      case "setConfigOption":
        break;
      // `prefixPrompt` and any future kind keep the prompt transport.
      default:
        continue;
    }
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

/** A command whose argument the user has not typed yet. Codex publishes
 * `/goal` as `prefixPrompt` with `input.hint` ("[<objective>|clear|pause|resume]"),
 * so sending a bare `/goal` only earns an error turn — the objective is the
 * point of the command. The composer arms it instead and spends the next
 * message as its argument.
 *
 * Read from the declared `input`, never from the command name: ACP v1 has no
 * `commandAction`, and a name-based rule would hijack a `/goal` that another
 * harness means as a plain prompt. */
export function pendingArgumentCommand(
  text: string,
  commands: readonly AcpAvailableCommand[],
): AcpAvailableCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || /\s/u.test(trimmed)) return undefined;
  const name = trimmed.slice(1);
  if (!name) return undefined;
  const command = commands.find((candidate) => candidate.name === name);
  if (!command?.input) return undefined;
  // A config switch is complete without an argument; only prompt-transport
  // commands are waiting for text.
  if (slashCommandConfigAction(command)) return undefined;
  return command;
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
