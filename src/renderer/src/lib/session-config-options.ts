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
