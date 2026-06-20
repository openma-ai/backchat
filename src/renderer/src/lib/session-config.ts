import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectValue,
} from "@shared/session-events.js";

export function findModelConfigOption(
  options: readonly SessionConfigOption[] | undefined,
): (SessionConfigOption & { type: "select" }) | undefined {
  const selectOptions = (options ?? []).filter(
    (option): option is SessionConfigOption & { type: "select" } =>
      option.type === "select",
  );
  return (
    selectOptions.find((option) => option.category === "model") ??
    selectOptions.find((option) => option.id === "model")
  );
}

export function flattenConfigSelectOptions(
  option: SessionConfigOption & { type: "select" },
): SessionConfigSelectValue[] {
  return option.options.flatMap((value) =>
    isSelectGroup(value) ? value.options : [value],
  );
}

export function configOptionCurrentLabel(
  option: SessionConfigOption & { type: "select" },
): string {
  return (
    flattenConfigSelectOptions(option).find(
      (value) => value.value === option.currentValue,
    )?.name ?? option.currentValue
  );
}

function isSelectGroup(
  value: SessionConfigSelectValue | SessionConfigSelectGroup,
): value is SessionConfigSelectGroup {
  return "group" in value;
}
