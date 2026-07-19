export type AcpSessionConfigOptionCategory =
  | "model"
  | "mode"
  | "thought_level"
  | string;

export interface AcpSessionConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}

export interface AcpSessionConfigSelectGroup {
  group: string;
  name: string;
  options: AcpSessionConfigSelectOption[];
}

export type AcpSessionConfigSelectOptions =
  | AcpSessionConfigSelectOption[]
  | AcpSessionConfigSelectGroup[];

export type AcpSessionConfigOption =
  | {
      id: string;
      name: string;
      description?: string | null;
      category?: AcpSessionConfigOptionCategory | null;
      type: "select";
      currentValue: string;
      options: AcpSessionConfigSelectOptions;
    }
  | {
      id: string;
      name: string;
      description?: string | null;
      category?: AcpSessionConfigOptionCategory | null;
      type: "boolean";
      currentValue: boolean;
    };

export function normalizeAgentConfigOptions(
  value: unknown,
): AcpSessionConfigOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value.filter(
    (candidate): candidate is AcpSessionConfigOption => {
      if (!candidate || typeof candidate !== "object") return false;
      const option = candidate as Record<string, unknown>;
      if (
        typeof option.id !== "string"
        || !option.id.trim()
        || typeof option.name !== "string"
        || !option.name.trim()
      ) {
        return false;
      }
      if (option.type === "boolean") {
        return typeof option.currentValue === "boolean";
      }
      if (option.type !== "select") return false;
      return (
        typeof option.currentValue === "string"
        && Array.isArray(option.options)
        && option.options.every(isConfigSelectEntry)
      );
    },
  );
  return options.length > 0 ? options : undefined;
}

export function applyConfigOverrides(
  options: AcpSessionConfigOption[] | undefined,
  overrides: Record<string, string | boolean>,
): AcpSessionConfigOption[] | undefined {
  if (!options?.length) return options;
  if (Object.keys(overrides).length === 0) return options;
  return options.map((option) => {
    const value = overrides[option.id];
    if (value === undefined) return option;
    if (option.type === "select" && typeof value === "string") {
      return { ...option, currentValue: value };
    }
    if (option.type === "boolean" && typeof value === "boolean") {
      return { ...option, currentValue: value };
    }
    return option;
  });
}

function isConfigSelectEntry(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (Array.isArray(entry.options)) {
    return (
      typeof entry.group === "string"
      && typeof entry.name === "string"
      && entry.options.every(isConfigSelectEntry)
    );
  }
  return typeof entry.value === "string" && typeof entry.name === "string";
}

export interface FlattenedConfigSelectOption extends AcpSessionConfigSelectOption {
  groupName?: string;
}

export interface ConfigOptionSection {
  category: "model" | "mode" | "thought_level" | "custom";
  label: string;
  options: AcpSessionConfigOption[];
}

export function buildConfigOptionSections(
  options: readonly AcpSessionConfigOption[] | undefined,
): ConfigOptionSection[] {
  if (!options?.length) return [];
  const buckets: Record<ConfigOptionSection["category"], AcpSessionConfigOption[]> = {
    model: [],
    mode: [],
    thought_level: [],
    custom: [],
  };
  for (const option of options) {
    const category = normalizeCategory(option.category);
    buckets[category].push(option);
  }
  return ([
    ["model", "Model"],
    ["mode", "Mode"],
    ["thought_level", "Thought"],
    ["custom", "Options"],
  ] as const)
    .map(([category, label]) => ({
      category,
      label,
      options: buckets[category],
    }))
    .filter((section) => section.options.length > 0);
}

export function buildRunMenuConfigOptionSections(
  options: readonly AcpSessionConfigOption[] | undefined,
): ConfigOptionSection[] {
  return buildConfigOptionSections(options)
    .map((section) => ({
      ...section,
      options:
        section.category === "custom"
          ? section.options.filter((option) => option.id === "fast-mode")
          : section.options,
    }))
    .filter(
      (section) =>
        (section.category === "model" ||
          section.category === "thought_level" ||
          section.category === "custom") &&
        section.options.length > 0,
    );
}

export function buildComposerConfigOptions(
  options: readonly AcpSessionConfigOption[] | undefined,
): AcpSessionConfigOption[] {
  return (options ?? []).filter((option) => {
    const category = normalizeCategory(option.category);
    return (
      category === "custom" &&
      option.id !== "collaboration_mode" &&
      option.id !== "fast-mode"
    );
  });
}

export function findModeConfigOption(
  options: readonly AcpSessionConfigOption[] | undefined,
): (AcpSessionConfigOption & { type: "select" }) | undefined {
  return options?.find(
    (option): option is AcpSessionConfigOption & { type: "select" } =>
      option.type === "select" &&
      (option.category === "mode" || option.id === "mode"),
  );
}

export function findSelectConfigOption(
  options: readonly AcpSessionConfigOption[] | undefined,
  id: string,
): (AcpSessionConfigOption & { type: "select" }) | undefined {
  return options?.find(
    (option): option is AcpSessionConfigOption & { type: "select" } =>
      option.type === "select" && option.id === id,
  );
}

export interface ConfigModeOptionPresentation {
  label: string;
  hint?: string;
  tone: "neutral" | "warning";
}

export function configModeOptionPresentation(
  agentId: string,
  option: AcpSessionConfigSelectOption,
): ConfigModeOptionPresentation {
  if (agentId === "codex-acp") {
    if (option.value === "read-only") {
      return {
        label: "Ask for approval",
        hint: "Always ask to edit external files and use the internet",
        tone: "neutral",
      };
    }
    if (option.value === "agent") {
      return {
        label: "Approve for me",
        hint: "Only ask for actions detected as potentially unsafe",
        tone: "neutral",
      };
    }
    if (option.value === "agent-full-access") {
      return {
        label: "Full access",
        hint: "Unrestricted access to the internet and any file on your computer",
        tone: "warning",
      };
    }
  }
  return {
    label: option.name,
    ...(option.description ? { hint: option.description } : {}),
    tone: "neutral",
  };
}

export function flattenSelectOptions(
  option: AcpSessionConfigOption,
): FlattenedConfigSelectOption[] {
  if (option.type !== "select") return [];
  const first = option.options[0];
  if (first && "options" in first) {
    return (option.options as AcpSessionConfigSelectGroup[]).flatMap((group) =>
      group.options.map((item) => ({
        ...item,
        groupName: group.name,
      })),
    );
  }
  return option.options as AcpSessionConfigSelectOption[];
}

export function selectedConfigOptionLabel(
  option: AcpSessionConfigOption,
): string {
  if (option.type === "boolean") return option.currentValue ? "On" : "Off";
  const selected = flattenSelectOptions(option).find(
    (item) => item.value === option.currentValue,
  );
  return selected?.name ?? option.currentValue;
}

export function selectedModeIdFromConfigOptions(
  options: readonly AcpSessionConfigOption[] | undefined,
): string | undefined {
  const mode = options?.find(
    (option) => option.type === "select" && option.category === "mode",
  );
  return mode?.type === "select" ? mode.currentValue : undefined;
}

function normalizeCategory(
  category: AcpSessionConfigOptionCategory | null | undefined,
): ConfigOptionSection["category"] {
  if (category === "model" || category === "mode" || category === "thought_level") {
    return category;
  }
  return "custom";
}
