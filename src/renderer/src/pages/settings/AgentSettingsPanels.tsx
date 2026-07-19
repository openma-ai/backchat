import { useMemo, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";

import type { AgentInfo } from "@shared/api";
import type { Settings } from "@shared/settings";
import { Button } from "@/components/ui/button";
import { patchSettings } from "@/lib/settings-store";
import { selectedAuthMethod } from "./agent-setup-lifecycle";
import {
  upsertAgentEnv,
  type CustomAgentFormState,
} from "./custom-agent-settings";

export function AgentAuthSetupPanel({
  agent,
  settings,
  selectedMethodId,
  waitingForAuth,
  pending,
  onMethodIdChange,
  onStart,
  onClose,
  onSaved,
}: {
  agent: AgentInfo;
  settings: Settings;
  selectedMethodId?: string;
  waitingForAuth: boolean;
  pending: boolean;
  onMethodIdChange: (methodId: string) => void;
  onStart: (methodId?: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const methods = agent.auth?.methods ?? [];
  const method = selectedAuthMethod(agent, selectedMethodId);
  const methodType = method?.type ?? "agent";
  const vars = method?.vars ?? [];
  const initialValues = useMemo(() => {
    const existing = settings.agents.find((item) => item.id === agent.id);
    const env = new Map(existing?.env.map((item) => [item.name, item.value]) ?? []);
    return Object.fromEntries(vars.map((variable) => [variable.name, env.get(variable.name) ?? ""]));
  }, [agent.id, settings.agents, vars]);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const save = async () => {
    await patchSettings({
      agents: upsertAgentEnv(settings, agent.id, values),
    });
    onSaved();
  };
  const actionLabel = methodType === "terminal"
    ? waitingForAuth ? "Open setup again" : "Open terminal setup"
    : waitingForAuth ? "Continue sign in" : "Continue";

  return (
    <div className="ml-9 mt-1 rounded-xl border border-border/40 bg-bg-surface/55 px-3 py-3 text-xs text-fg-muted shadow-card-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-fg">Set up {agent.label}</div>
          <p className="mt-1">
            Choose one of the authentication methods advertised by this Agent.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-7 px-2 text-xs">
          Close
        </Button>
      </div>

      {methods.length > 1 && (
        <div className="mt-3 grid gap-1" role="radiogroup" aria-label={`Authentication method for ${agent.label}`}>
          {methods.map((candidate) => {
            const selected = candidate.id === method?.id;
            return (
              <button
                key={candidate.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onMethodIdChange(candidate.id)}
                disabled={pending}
                className={`flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  selected ? "bg-bg text-fg" : "hover:bg-bg/55 hover:text-fg"
                }`}
              >
                <span
                  className={`mt-0.5 size-3.5 shrink-0 rounded-full border ${
                    selected ? "border-brand bg-brand shadow-[inset_0_0_0_3px_var(--color-bg)]" : "border-border-strong"
                  }`}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{candidate.name ?? candidate.id}</span>
                  {candidate.description && (
                    <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-fg-subtle">
                      {candidate.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {methods.length <= 1 && method?.description && (
        <p className="mt-3 max-w-[64ch] leading-5">{method.description}</p>
      )}

      {methodType === "env_var" ? (
        <>
          <p className="mt-2 text-[11px] leading-4 text-fg-subtle">
            Saved as this Agent&apos;s local environment override and passed only when OpenMA starts it.
          </p>
          <div className="mt-3 grid gap-2">
            {vars.map((variable) => (
              <label key={variable.name} className="grid gap-1">
                <span className="font-mono text-[11px] text-fg-subtle">
                  {variable.name}
                  {variable.optional ? " (optional)" : ""}
                </span>
                <input
                  type={variable.secret === false ? "text" : "password"}
                  value={values[variable.name] ?? ""}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [variable.name]: event.target.value }))
                  }
                  placeholder={variable.label ?? variable.name}
                  className="h-8 rounded-md border border-border-subtle bg-bg px-2 font-mono text-xs text-fg outline-none transition-colors focus:border-border-strong"
                />
              </label>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-[11px] leading-4 text-fg-subtle">
          {methodType === "terminal"
            ? `${agent.label} manages credentials in its own terminal setup.`
            : `${agent.label} handles sign-in through its ACP authentication flow.`}
        </p>
      )}

      {waitingForAuth && (
        <div className="mt-3 rounded-lg bg-brand/8 px-2.5 py-2 text-[11px] leading-4 text-fg-muted">
          Finish setup outside OpenMA. The next real session will use the new credentials.
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        {method?.link ? (
          <a href={method.link} className="inline-flex items-center gap-1 text-fg-muted hover:text-fg">
            <ExternalLinkIcon className="size-3" />
            Credential source
          </a>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          {methodType === "env_var" ? (
            <Button type="button" size="sm" onClick={save} disabled={pending} className="h-7 px-2 text-xs">
              Save
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => onStart(method?.id)}
              disabled={pending || !method}
              className="h-7 px-2 text-xs"
            >
              {pending ? "Opening…" : actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CustomAgentPanel({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: CustomAgentFormState;
  onChange: (next: CustomAgentFormState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const inputClass = "h-7 rounded-md border border-border/60 bg-bg/80 px-2 text-xs text-fg outline-none focus:border-border-strong";
  const textareaClass = "min-h-16 rounded-md border border-border/60 bg-bg/80 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-border-strong";
  return (
    <div className="mt-3 rounded-xl border border-border/45 bg-bg/70 px-3 py-3 text-xs text-fg-muted shadow-card-soft">
      <div className="grid gap-2 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="font-medium text-fg">ID</span>
          <input
            value={value.id}
            onChange={(event) => onChange({ ...value, id: event.target.value })}
            placeholder="studio"
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-fg">Name</span>
          <input
            value={value.label}
            onChange={(event) => onChange({ ...value, label: event.target.value })}
            placeholder="Studio ACP"
            className={inputClass}
          />
        </label>
      </div>
      <label className="mt-2 grid gap-1">
        <span className="font-medium text-fg">Command</span>
        <input
          value={value.command}
          onChange={(event) => onChange({ ...value, command: event.target.value })}
          placeholder="/usr/local/bin/studio-acp"
          className={`${inputClass} font-mono`}
        />
      </label>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="font-medium text-fg">Arguments</span>
          <textarea
            value={value.argsText}
            onChange={(event) => onChange({ ...value, argsText: event.target.value })}
            placeholder={"--acp\n--profile=work"}
            className={textareaClass}
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-fg">Environment</span>
          <textarea
            value={value.envText}
            onChange={(event) => onChange({ ...value, envText: event.target.value })}
            placeholder={"STUDIO_TOKEN=...\nOPENAI_API_KEY=..."}
            className={textareaClass}
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-7 px-2 text-xs">
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onSave} className="h-7 px-2 text-xs">
          Save and check
        </Button>
      </div>
    </div>
  );
}
