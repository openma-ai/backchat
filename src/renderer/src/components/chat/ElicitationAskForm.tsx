import { useMemo, useState, type FormEvent } from "react";
import { ArrowRightIcon, CheckIcon, PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  ElicitationFieldInfo,
  ElicitationFormAskInfo,
  ElicitationFormResponseInfo,
} from "@shared/api.js";

type DraftValue = string | boolean | string[];

export function ElicitationAskForm({
  ask,
  onSubmit,
}: {
  ask: ElicitationFormAskInfo;
  onSubmit: (response: ElicitationFormResponseInfo) => void | Promise<void>;
}) {
  const initialValues = useMemo(() => initialElicitationValues(ask.fields), [ask]);
  const [values, setValues] = useState<Record<string, DraftValue>>(initialValues);
  const [error, setError] = useState<string>();
  const possibleChoiceField = ask.fields.find((field) => field.type === "select");
  const possibleOtherField = possibleChoiceField
    ? ask.fields.find((field) =>
        field.type === "text"
        && !field.required
        && field.name === `${possibleChoiceField.name}__other`)
    : undefined;
  const choiceField = possibleChoiceField
    && ask.fields.every((field) =>
      field === possibleChoiceField || field === possibleOtherField)
    ? possibleChoiceField
    : null;
  const choiceOtherField = choiceField && possibleOtherField?.type === "text"
    ? possibleOtherField
    : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = elicitationContentFromDraft(ask.fields, values);
    if (!content) {
      setError("Complete the required fields with valid values.");
      return;
    }
    setError(undefined);
    void onSubmit({ action: "accept", content });
  };

  if (choiceField) {
    const draftOtherValue = choiceOtherField
      ? values[choiceOtherField.name]
      : undefined;
    const otherValue = typeof draftOtherValue === "string"
      ? draftOtherValue
      : "";
    return (
      <form
        className="min-w-0"
        data-elicitation-form="choice"
        onSubmit={(event) => {
          event.preventDefault();
          if (!choiceOtherField || !otherValue.trim()) return;
          void onSubmit({
            action: "accept",
            content: { [choiceOtherField.name]: otherValue.trim() },
          });
        }}
      >
        <div className="max-h-[48vh] space-y-1.5 overflow-auto py-1">
          {choiceField.description
            && choiceField.description.trim() !== ask.message.trim() && (
            <p className="px-2 pb-1 text-xs leading-5 text-fg-muted">
              {choiceField.description}
            </p>
          )}
          {choiceField.options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              data-elicitation-choice={option.value}
              className="group flex w-full items-center gap-3 rounded-xl bg-bg/45 px-3 py-2.5 text-left transition-colors hover:bg-bg/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => void onSubmit({
                action: "accept",
                content: { [choiceField.name]: option.value },
              })}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 text-xs tabular-nums text-fg-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium text-fg">
                {option.label}
              </span>
              <ArrowRightIcon className="size-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          ))}
          {choiceOtherField && (
            <div
              data-elicitation-other={choiceOtherField.name}
              className="group flex w-full items-center gap-3 rounded-xl bg-bg/45 px-3 py-2.5 transition-colors focus-within:bg-bg/75"
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 text-fg-muted">
                <PencilIcon className="size-3.5" aria-hidden="true" />
              </span>
              <label className="min-w-0 flex-1">
                <span className="sr-only">{choiceOtherField.title}</span>
                <input
                  name={choiceOtherField.name}
                  value={otherValue}
                  placeholder={choiceOtherField.title}
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    [choiceOtherField.name]: event.currentTarget.value,
                  }))}
                  className="h-6 w-full bg-transparent text-sm font-medium text-fg outline-none placeholder:text-fg-muted"
                />
                {choiceOtherField.description && (
                  <span className="block truncate text-[11px] leading-4 text-fg-subtle">
                    {choiceOtherField.description}
                  </span>
                )}
              </label>
              <button
                type="submit"
                disabled={!otherValue.trim()}
                aria-label={`Submit ${choiceOtherField.title}`}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-bg disabled:opacity-0"
              >
                <ArrowRightIcon className="size-4" />
              </button>
            </div>
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => void onSubmit({ action: "decline" })}
          >
            Skip
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="min-w-0" data-elicitation-form="structured">
      <div className="max-h-[48vh] space-y-3 overflow-auto py-2">
        {ask.fields.map((field) => (
          <ElicitationField
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(value) => setValues((current) => ({
              ...current,
              [field.name]: value,
            }))}
          />
        ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void onSubmit({ action: "decline" })}
        >
          Decline
        </Button>
        <Button type="submit" size="sm">Submit</Button>
      </div>
    </form>
  );
}

function ElicitationField({
  field,
  value,
  onChange,
}: {
  field: ElicitationFieldInfo;
  value: DraftValue | undefined;
  onChange: (value: DraftValue) => void;
}) {
  const id = `elicitation-${field.name}`;
  const description = field.description
    ? <p className="text-[11px] text-fg-muted">{field.description}</p>
    : null;
  if (field.type === "boolean") {
    return (
      <div className="space-y-1.5 rounded-xl bg-bg/45 px-3 py-2.5">
        <label className="flex items-center gap-3 text-xs font-medium text-fg">
          <input
            id={id}
            name={field.name}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
          <span className="min-w-0 flex-1">{field.title}</span>
          {value === true && <CheckIcon className="size-3.5 text-primary" />}
        </label>
        {description}
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div className="space-y-1.5">
        <FieldLabel id={id} field={field} />
        {description}
        <select
          id={id}
          name={field.name}
          required={field.required}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="h-9 w-full rounded-xl border border-border/50 bg-bg/45 px-3 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/40"
        >
          {!field.required && <option value="">Skip</option>}
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    );
  }
  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-fg">
          {field.title}{field.required ? " *" : ""}
        </legend>
        {description}
        {field.options.map((option) => (
          <label key={option.value} className="flex items-center gap-3 rounded-xl bg-bg/45 px-3 py-2.5 text-xs text-fg transition-colors hover:bg-bg/75">
            <input
              name={field.name}
              type="checkbox"
              value={option.value}
              checked={selected.includes(option.value)}
              onChange={(event) => onChange(
                event.currentTarget.checked
                  ? [...selected, option.value]
                  : selected.filter((item) => item !== option.value),
              )}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    );
  }
  const numeric = field.type === "number";
  return (
    <div className="space-y-1.5">
      <FieldLabel id={id} field={field} />
      {description}
      <input
        id={id}
        name={field.name}
        type={numeric ? "number" : field.format === "email" ? "email" : "text"}
        required={field.required}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...(numeric
          ? { min: field.minimum, max: field.maximum, step: field.integer ? 1 : "any" }
          : {
              minLength: field.minLength,
              maxLength: field.maxLength,
              pattern: field.pattern,
            })}
        className="h-9 w-full rounded-xl border border-border/50 bg-bg/45 px-3 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/40"
      />
    </div>
  );
}

function FieldLabel({
  id,
  field,
}: {
  id: string;
  field: ElicitationFieldInfo;
}) {
  return (
    <label htmlFor={id} className="text-xs font-medium text-fg">
      {field.title}{field.required ? " *" : ""}
    </label>
  );
}

function initialElicitationValues(
  fields: readonly ElicitationFieldInfo[],
): Record<string, DraftValue> {
  return Object.fromEntries(fields.map((field) => {
    if (field.type === "boolean") return [field.name, field.defaultValue ?? false];
    if (field.type === "multiselect") return [field.name, field.defaultValue ?? []];
    if (field.type === "number") {
      return [field.name, field.defaultValue === undefined ? "" : String(field.defaultValue)];
    }
    return [field.name, field.defaultValue ?? ""];
  }));
}

export function elicitationContentFromDraft(
  fields: readonly ElicitationFieldInfo[],
  values: Readonly<Record<string, DraftValue | undefined>>,
): Record<string, string | number | boolean | string[]> | null {
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.type === "number") {
      if (value === "" || value === undefined) {
        if (field.required) return null;
        continue;
      }
      const parsed = typeof value === "string" ? Number(value) : Number.NaN;
      if (
        !Number.isFinite(parsed)
        || (field.integer && !Number.isInteger(parsed))
        || (field.minimum !== undefined && parsed < field.minimum)
        || (field.maximum !== undefined && parsed > field.maximum)
      ) return null;
      content[field.name] = parsed;
      continue;
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean") return null;
      content[field.name] = value;
      continue;
    }
    if (field.type === "multiselect") {
      const selected = Array.isArray(value) ? value : [];
      const minimum = field.minItems ?? (field.required ? 1 : 0);
      if (
        selected.length < minimum
        || (field.maxItems !== undefined && selected.length > field.maxItems)
      ) return null;
      if (selected.length > 0) content[field.name] = selected;
      continue;
    }
    const text = typeof value === "string" ? value : "";
    if (!text && !field.required) continue;
    if (!text && field.required) return null;
    if (field.type === "text") {
      if (field.minLength !== undefined && text.length < field.minLength) return null;
      if (field.maxLength !== undefined && text.length > field.maxLength) return null;
    } else if (!field.options.some((option) => option.value === text)) {
      return null;
    }
    content[field.name] = text;
  }
  return content;
}
