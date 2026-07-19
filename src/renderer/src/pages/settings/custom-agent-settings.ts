import type { Settings } from "@shared/settings";

export interface CustomAgentFormState {
  id: string;
  label: string;
  command: string;
  argsText: string;
  envText: string;
}

export function parseCustomAgentArgs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseCustomAgentEnv(text: string): Settings["agents"][number]["env"] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("=");
      if (idx < 0) return { name: line, value: "" };
      return {
        name: line.slice(0, idx).trim(),
        value: line.slice(idx + 1).trim(),
      };
    })
    .filter((entry) => entry.name.length > 0);
}

export function customAgentRows(settings: Settings): CustomAgentFormState[] {
  return settings.agents
    .filter((agent) => typeof agent.command_override === "string" && agent.command_override.length > 0)
    .map((agent) => ({
      id: agent.id,
      label: agent.label_override ?? agent.id,
      command: agent.command_override ?? "",
      argsText: (agent.args_override ?? []).join("\n"),
      envText: agent.env.map((entry) => `${entry.name}=${entry.value}`).join("\n"),
    }));
}

export function upsertCustomAgentServer(
  settings: Settings,
  form: CustomAgentFormState,
): Settings["agents"] {
  const id = form.id.trim();
  const command = form.command.trim();
  if (!id || !command) return settings.agents;
  const rest = settings.agents.filter((agent) => agent.id !== id);
  const args = parseCustomAgentArgs(form.argsText);
  return [
    ...rest,
    {
      id,
      enabled: true,
      ...(form.label.trim() ? { label_override: form.label.trim() } : {}),
      command_override: command,
      ...(args.length > 0 ? { args_override: args } : {}),
      env: parseCustomAgentEnv(form.envText),
    },
  ];
}

export function removeCustomAgentServer(settings: Settings, id: string): Settings["agents"] {
  return settings.agents.filter((agent) => agent.id !== id || !agent.command_override);
}

export function upsertAgentEnv(
  settings: Settings,
  agentId: string,
  values: Record<string, string>,
): Settings["agents"] {
  const existing = settings.agents.find((agent) => agent.id === agentId);
  const names = new Set(Object.keys(values));
  const keptEnv = (existing?.env ?? []).filter((entry) => !names.has(entry.name));
  const nextEnv = [
    ...keptEnv,
    ...Object.entries(values)
      .filter(([, value]) => value.length > 0)
      .map(([name, value]) => ({ name, value })),
  ];
  const rest = settings.agents.filter((agent) => agent.id !== agentId);
  if (
    nextEnv.length === 0 &&
    !existing?.enabled &&
    !existing?.label_override &&
    !existing?.command_override &&
    !existing?.args_override
  ) {
    return rest;
  }
  return [
    ...rest,
    {
      id: agentId,
      ...(existing?.enabled ? { enabled: true } : {}),
      ...(existing?.label_override
        ? { label_override: existing.label_override }
        : {}),
      ...(existing?.command_override
        ? { command_override: existing.command_override }
        : {}),
      ...(existing?.args_override
        ? { args_override: existing.args_override }
        : {}),
      env: nextEnv,
    },
  ];
}

export function upsertAgentEnabled(
  settings: Settings,
  agentId: string,
  enabled: boolean,
): Settings["agents"] {
  const existing = settings.agents.find((agent) => agent.id === agentId);
  const rest = settings.agents.filter((agent) => agent.id !== agentId);
  if (
    !enabled &&
    !existing?.label_override &&
    !existing?.command_override &&
    !existing?.args_override &&
    (existing?.env ?? []).length === 0
  ) {
    return rest;
  }
  return [
    ...rest,
    {
      id: agentId,
      ...(enabled ? { enabled: true } : {}),
      ...(existing?.label_override
        ? { label_override: existing.label_override }
        : {}),
      ...(existing?.command_override
        ? { command_override: existing.command_override }
        : {}),
      ...(existing?.args_override
        ? { args_override: existing.args_override }
        : {}),
      env: existing?.env ?? [],
    },
  ];
}
