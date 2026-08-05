import { useMemo, useState, type FormEvent } from "react";

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

  return (
    <form onSubmit={submit}>
      <div className="max-h-[55vh] space-y-4 overflow-auto p-4">
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
      <div className="flex justify-end gap-2 border-t border-border/60 p-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void onSubmit({ action: "decline" })}
        >
          Decline
        </Button>
        <Button type="submit">Submit</Button>
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
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-fg">
          <input
            id={id}
            name={field.name}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
          {field.title}
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
          className="h-9 w-full rounded-md border border-border bg-bg-surface px-3 text-sm"
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
          <label key={option.value} className="flex items-center gap-2 text-xs text-fg">
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
        className="h-9 w-full rounded-md border border-border bg-bg-surface px-3 text-sm"
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
