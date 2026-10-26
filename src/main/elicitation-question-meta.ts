import type {
  ElicitationFieldInfo,
  ElicitationQuestionInfo,
  ElicitationQuestionOptionInfo,
} from "../shared/api.js";

type MetaOption = { label: string; description?: string };

/** dsh-acp currently encodes questions as question_i fields (not yet in its metadata.md); verify the binding against the normalized form schema. */
export function questionsFromDshUserQuestionsMeta(
  meta: unknown,
  fields: readonly ElicitationFieldInfo[],
): ElicitationQuestionInfo[] | undefined {
  const value = recordValue(meta);
  if (value.version !== 1 || !Array.isArray(value.questions) || value.questions.length === 0) {
    return undefined;
  }

  const fieldByName = new Map<string, ElicitationFieldInfo>();
  for (const field of fields) {
    if (fieldByName.has(field.name)) return undefined;
    fieldByName.set(field.name, field);
  }

  const ids = new Set<string>();
  const claimedFields = new Set<string>();
  const questions: ElicitationQuestionInfo[] = [];

  for (const [index, rawQuestion] of value.questions.entries()) {
    const questionValue = recordValue(rawQuestion);
    const id = nonEmptyString(questionValue.id);
    const question = nonEmptyString(questionValue.question);
    if (!id || !question || ids.has(id)) return undefined;
    ids.add(id);

    if (questionValue.options !== undefined && !Array.isArray(questionValue.options)) {
      return undefined;
    }
    const rawOptions = questionValue.options ?? [];
    const metaOptions: MetaOption[] = [];
    for (const rawOption of rawOptions) {
      const option = recordValue(rawOption);
      if (typeof option.label !== "string") return undefined;
      metaOptions.push({
        label: option.label,
        ...(nonEmptyString(option.description)
          ? { description: nonEmptyString(option.description) }
          : {}),
      });
    }

    const fieldName = `question_${index}`;
    const field = fieldByName.get(fieldName);
    if (!field) return undefined;
    claimedFields.add(fieldName);

    const multiSelect = questionValue.multiSelect === true;
    const options: ElicitationQuestionOptionInfo[] = [];
    let customField: string | undefined;
    if (metaOptions.length > 0) {
      if (
        (multiSelect && field.type !== "multiselect")
        || (!multiSelect && field.type !== "select")
      ) {
        return undefined;
      }
      if (field.type !== "select" && field.type !== "multiselect") return undefined;
      const fieldOptions = field.options;
      if (
        fieldOptions.length < metaOptions.length
        || fieldOptions.length > metaOptions.length + 1
      ) return undefined;
      for (const [optionIndex, metaOption] of metaOptions.entries()) {
        const fieldOption = fieldOptions[optionIndex];
        if (!fieldOption || fieldOption.label !== metaOption.label) return undefined;
        options.push({
          value: fieldOption.value,
          label: metaOption.label,
          ...(metaOption.description ? { description: metaOption.description } : {}),
        });
      }
      const customFieldName = `${fieldName}__other`;
      const custom = fieldByName.get(customFieldName);
      if (custom?.type === "text") {
        customField = customFieldName;
        claimedFields.add(customFieldName);
      }
    } else if (field.type !== "text") {
      return undefined;
    }

    const header = nonEmptyString(questionValue.header);
    const detail = nonEmptyString(questionValue.detail);
    const intentValue = recordValue(questionValue.intent);
    const intent = intentValue.kind === "plan-review"
      && typeof intentValue.approve === "string"
      && options.some((option) => option.label === intentValue.approve)
      && detail
      ? { kind: "plan-review" as const, approve: intentValue.approve }
      : undefined;

    questions.push({
      id,
      question,
      ...(header ? { header } : {}),
      ...(detail ? { detail } : {}),
      multiSelect,
      field: fieldName,
      ...(customField ? { customField } : {}),
      options,
      ...(intent ? { intent } : {}),
    });
  }

  if (claimedFields.size !== fields.length) return undefined;
  return questions;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
