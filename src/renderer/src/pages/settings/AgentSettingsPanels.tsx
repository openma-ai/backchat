import { useI18n } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { ExternalLinkIcon } from "@/components/Icons";

import type { AgentInfo } from "@shared/api";
import type { Settings } from "@shared/settings";
import {
  authFieldInputType,
  authMethodKind,
  authChoiceDescription,
  authChoiceLabel,
  authDialogShouldClose,
  authFieldValue,
  authSubmitValues,
  authVariableLabel,
  clearAuthDraft,
  filterAuthMethods,
  groupAuthMethods,
  initialAuthDraft,
  type AuthMethodKind,
} from "@/lib/auth-method-menu";
import { composerBoxClass } from "@/lib/composer-box";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { PopupContent, PopupHeader } from "@/components/ui/popup";
import { StatusNotice } from "@/components/ui/status-notice";
import { patchSettings } from "@/lib/settings-store";
import { selectedAuthMethod } from "./agent-setup-lifecycle";
import {
  upsertAgentEnv,
  type CustomAgentFormState,
} from "./custom-agent-settings";

const AUTH_GROUP_LABEL: Record<AuthMethodKind, "auth.group.oauth" | "auth.group.apiKey" | "auth.group.gateway" | "auth.group.terminal"> = {
  oauth: "auth.group.oauth",
  "api-key": "auth.group.apiKey",
  gateway: "auth.group.gateway",
  terminal: "auth.group.terminal",
};

export function AgentAuthSetupPanel({
  agent,
  settings,
  selectedMethodId,
  waitingForAuth,
  pending,
  error,
  onMethodIdChange,
  onStart,
  onClose,
  onSaved,
  supportsLogout,
  logoutPending = false,
  onLogout,
}: {
  agent: AgentInfo;
  settings: Settings;
  selectedMethodId?: string;
  waitingForAuth: boolean;
  pending: boolean;
  error?: string;
  onMethodIdChange: (methodId: string) => void;
  onStart: (methodId?: string, options?: { values?: Record<string, string> }) => void;
  onClose: () => void;
  onSaved: () => void;
  /** Live session or probe advertised `agentCapabilities.auth.logout`. */
  supportsLogout?: boolean;
  logoutPending?: boolean;
  onLogout?: () => void;
}) {
  const { t } = useI18n();
  const methods = agent.auth?.methods ?? [];
  const [query, setQuery] = useState("");
  const [activeMethodId, setActiveMethodId] = useState(selectedMethodId);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const method = selectedAuthMethod(agent, activeMethodId);
  const methodType = method?.type ?? "agent";
  const vars = method?.vars ?? [];
  const isLocalEnvForm = methodType === "env_var";
  const isAuthenticateForm = method?.form === "fields";
  const savedEnv = useMemo(() => {
    const existing = settings.agents.find((item) => item.id === agent.id);
    return new Map(existing?.env.map((item) => [item.name, item.value]) ?? []);
  }, [agent.id, settings.agents]);
  const values = method ? (drafts[method.id] ?? initialAuthDraft(method, savedEnv)) : {};
  const requiredFilled = vars
    .filter((variable) => variable.optional !== true)
    .every((variable) => authFieldValue(values, variable.name).trim().length > 0);
  const visibleGroups = groupAuthMethods(filterAuthMethods(methods, query));
  const showMenu = methods.length > 1;
  const busy = pending || logoutPending;

  useEffect(() => {
    setQuery("");
    setDrafts({});
    setActiveMethodId(selectedMethodId);
    // Method changes are owned by this dialog. Reset only when the agent changes,
    // otherwise picking a method would wipe the secret the user just isolated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const pickMethod = (methodId: string) => {
    const currentId = method!.id;
    setDrafts((current) => clearAuthDraft(
      current,
      currentId !== methodId ? currentId : undefined,
    ));
    setActiveMethodId(methodId);
    onMethodIdChange(methodId);
  };
  const writeField = (name: string, next: string) => {
    const active = method!;
    setDrafts((current) => ({
      ...current,
      [active.id]: {
        ...(current[active.id] ?? initialAuthDraft(active, savedEnv)),
        [name]: next,
      },
    }));
  };
  const primaryLabel = !method
    ? ""
    : pending
      ? (isLocalEnvForm || isAuthenticateForm ? t("auth.saving") : t("auth.opening"))
      : isLocalEnvForm || isAuthenticateForm
        ? t("auth.save")
        : methodType === "terminal"
          ? (waitingForAuth ? t("auth.openAgain") : t("auth.openTerminal"))
          : (waitingForAuth ? t("auth.continueSignIn") : t("auth.continue"));

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (authDialogShouldClose(next, busy)) onClose();
      }}
    >
      <PopupContent
        data-auth-setup-dialog=""
        showCloseButton={!busy}
        className="!max-w-2xl"
      >
        <PopupHeader>
          <DialogTitle>{t("auth.setupTitle", { agent: agent.label })}</DialogTitle>
          <DialogDescription>{t("auth.setupDescription")}</DialogDescription>
        </PopupHeader>
        <div className={cn(
          "grid min-h-0 border-t border-border/60",
          showMenu && "sm:grid-cols-[minmax(0,1.15fr)_minmax(15rem,0.85fr)]",
        )}>
          {showMenu && (
            <Command
              label={t("auth.searchLabel")}
              shouldFilter={false}
              className="rounded-none! bg-transparent! shadow-none!"
            >
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder={t("auth.search")}
                aria-label={t("auth.searchLabel")}
              />
              <CommandList
                data-auth-method-list=""
                className="max-h-72"
                aria-label={t("auth.methodList", { agent: agent.label })}
              >
                {visibleGroups.length === 0 ? (
                  <CommandEmpty>{t("auth.searchEmpty")}</CommandEmpty>
                ) : visibleGroups.map((group) => (
                  <CommandGroup key={group.kind} heading={t(AUTH_GROUP_LABEL[group.kind])}>
                    {group.methods.map((candidate) => {
                      const selected = candidate.id === method?.id;
                      return (
                        <CommandItem
                          key={candidate.id}
                          value={`${authChoiceLabel(candidate)} ${candidate.id}`}
                          keywords={[
                            authChoiceDescription(candidate),
                            authMethodKind(candidate),
                            candidate.id,
                          ]}
                          disabled={busy}
                          data-checked={selected}
                          data-auth-method={candidate.id}
                          onSelect={() => pickMethod(candidate.id)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{authChoiceLabel(candidate)}</span>
                            {candidate.description && (
                              <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                                {candidate.description}
                              </span>
                            )}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          )}
          <div
            data-auth-method-detail={method?.id ?? ""}
            className="flex min-h-0 flex-col gap-3 px-4 py-3 sm:max-h-80 sm:overflow-y-auto sm:bg-muted/30"
          >
            {method ? (
              <>
                <div>
                  <div className="text-sm font-medium text-foreground">{authChoiceLabel(method)}</div>
                  {method.description && (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{method.description}</p>
                  )}
                </div>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {isLocalEnvForm
                    ? t("auth.envHint")
                    : isAuthenticateForm
                      ? t("auth.fieldsHint")
                      : methodType === "terminal"
                        ? t("auth.terminalHint", { agent: agent.label })
                        : t("auth.agentHint", { agent: agent.label })}
                </p>
                {(isLocalEnvForm || isAuthenticateForm) && (
                  <div key={method.id} className="grid gap-2">
                    {vars.map((variable) => (
                      <label key={variable.name} className="grid gap-1">
                        <span className={cn(
                          "text-[11px] text-muted-foreground",
                          isLocalEnvForm && "font-mono",
                        )}>
                          {authVariableLabel(variable, isLocalEnvForm)}
                          {variable.optional ? ` (${t("auth.optional")})` : ""}
                        </span>
                        <input
                          data-auth-field={variable.name}
                          type={authFieldInputType(method, variable)}
                          name={`${method.id}:${variable.name}`}
                          autoComplete="off"
                          value={authFieldValue(values, variable.name)}
                          disabled={busy}
                          onChange={(event) => writeField(variable.name, event.target.value)}
                          placeholder={authVariableLabel(variable, false)}
                          className="h-8 rounded-md border border-border-subtle bg-background px-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-border-strong"
                        />
                      </label>
                    ))}
                  </div>
                )}
                {waitingForAuth && !isAuthenticateForm && (
                  <div className="rounded-lg bg-brand/8 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
                    {t("auth.waiting")}
                  </div>
                )}
                {method.link ? (
                  <a href={method.link} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <ExternalLinkIcon className="size-3" />
                    {t("auth.credentialSource")}
                  </a>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("auth.noMethods")}</p>
            )}
          </div>
        </div>
        {error && (
          <StatusNotice tone="danger" appearance="surface" className="mx-4 mb-3">
            {error}
          </StatusNotice>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
          {supportsLogout ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-auth-logout=""
              onClick={onLogout}
              disabled={busy || !onLogout}
              className="h-7 px-2 text-xs"
            >
              {logoutPending ? t("auth.loggingOut") : t("auth.logout")}
            </Button>
          ) : <span />}
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-auth-dismiss=""
              onClick={onClose}
              className="h-7 px-2 text-xs"
            >
              {t("auth.close")}
            </Button>
            {method && (
              <Button
                type="button"
                size="sm"
                data-auth-submit=""
                onClick={() => {
                  const active = method!;
                  if (isLocalEnvForm) {
                    void patchSettings({
                      agents: upsertAgentEnv(settings, agent.id, authSubmitValues(active, values)),
                    }).then(onSaved);
                    return;
                  }
                  if (isAuthenticateForm) {
                    onStart(active.id, { values: authSubmitValues(active, values) });
                    return;
                  }
                  onStart(active.id);
                }}
                disabled={busy || (isAuthenticateForm && !requiredFilled)}
                className="h-7 px-2 text-xs"
              >
                {primaryLabel}
              </Button>
            )}
          </div>
        </div>
      </PopupContent>
    </Dialog>
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
  const { t } = useI18n();
  const inputClass = "h-7 rounded-md border border-border/60 bg-bg/80 px-2 text-xs text-fg outline-none focus:border-border-strong";
  const textareaClass = "min-h-16 rounded-md border border-border/60 bg-bg/80 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-border-strong";
  return (
    <div className={composerBoxClass({ className: "mt-3 px-3 py-3 text-xs text-fg-muted" })}>
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
            placeholder={t("settings.studioAcp")}
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
