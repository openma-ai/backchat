import {
  BrainIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  EyeIcon,
  HandIcon,
  LightbulbIcon,
  MonitorIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TerminalIcon,
  WrenchIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentIcon } from "@/components/AgentIcon";
import {
  buildComposerConfigOptions,
  buildRunMenuConfigOptionSections,
  configModeOptionPresentation,
  findModeConfigOption,
  findSelectConfigOption,
  flattenSelectOptions,
  selectedConfigOptionLabel,
  type AcpSessionConfigOption,
} from "@/lib/session-config-options";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

export type ComposerAgentOption = {
  id: string;
  label: string;
  command: string;
  detected: boolean;
  installed?: boolean;
};

export function SessionRunChip({
  disabled,
  locked,
  agents,
  currentAgentId,
  currentAgentLabel,
  configOptions,
  onPickAgent,
  onSetConfigOption,
}: {
  disabled: boolean;
  locked: boolean;
  agents: ComposerAgentOption[];
  currentAgentId: string;
  currentAgentLabel?: string;
  onPickAgent: (agentId: string) => void;
  configOptions?: AcpSessionConfigOption[];
  onSetConfigOption: (configId: string, value: string | boolean) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const noHarnessSetup = agents.length === 0 && !locked;
  const agentLabel = noHarnessSetup
    ? t("chat.noHarness")
    : currentAgentLabel ||
      (currentAgentId ? currentAgentId : t("chat.chooseAgent"));
  const configSections = useMemo(
    () => buildRunMenuConfigOptionSections(configOptions),
    [configOptions],
  );
  const configSummary = noHarnessSetup
    ? undefined
    : configOptions?.find((option) => option.category === "model") ??
      configOptions?.find((option) => option.category === "thought_level");
  const configLabel = configSummary
    ? selectedConfigOptionLabel(configSummary)
    : t("chat.configure");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "inline-flex max-w-[280px] items-center gap-1 rounded-md px-2 text-xs text-fg-muted",
          "hover:bg-bg-surface/60 hover:text-fg",
          "focus:outline-none focus:bg-bg-surface/60",
          "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        )}
        style={{ height: "32px" }}
        aria-label={
          noHarnessSetup
            ? "Run on Local with no harness setup"
            : `Run on Local with ${agentLabel} using ${configLabel}`
        }
      >
        <MonitorIcon className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="shrink-0">{t("chat.local")}</span>
        <span className="text-fg-subtle">·</span>
        {noHarnessSetup ? (
          <span className="shrink-0">{agentLabel}</span>
        ) : (
          <AgentIcon
            agentId={currentAgentId}
            className="size-3.5 shrink-0 text-fg-muted"
            title={agentLabel}
          />
        )}
        {!noHarnessSetup && (
          <>
            <span className="text-fg-subtle">·</span>
            <span className="shrink-0">{configLabel}</span>
          </>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[280px]">
        <SessionRunSection title={t("chat.runtime")}>
          <SessionRunItem
            icon={MonitorIcon}
            label={t("chat.local")}
            hint={t("chat.thisMachine")}
            active
            onSelect={() => undefined}
          />
        </SessionRunSection>

        <SessionRunSection title={t("chat.harness")}>
          {agents.length > 0 ? (
            agents.map((agent) => (
              <SessionRunItem
                key={agent.id}
                agentId={agent.id}
                label={agent.label}
                hint={agent.command}
                active={agent.id === currentAgentId}
                disabled={locked}
                onSelect={() => onPickAgent(agent.id)}
              />
            ))
          ) : (
            <SessionRunItem
              icon={TerminalIcon}
              label={t("chat.noHarness")}
              hint="Open Settings to install and enable"
              onSelect={() => void navigate({ to: "/settings/agents" })}
            />
          )}
        </SessionRunSection>

        {configSections.length > 0 && (
          <div className="border-b border-border/50 py-1 last:border-b-0">
            {configSections.flatMap((section) =>
              section.options.map((option) => (
                <SessionConfigSubmenu
                  key={option.id}
                  option={option}
                  onSetConfigOption={onSetConfigOption}
                />
              )),
            )}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionConfigSubmenu({
  option,
  onSetConfigOption,
}: {
  option: AcpSessionConfigOption;
  onSetConfigOption: (configId: string, value: string | boolean) => void;
}) {
  const { t } = useI18n();
  const Icon = configOptionIcon(option);
  const label =
    option.category === "model"
      ? t("chat.model")
      : option.category === "thought_level"
        ? t("chat.effort")
        : option.id === "fast-mode"
          ? t("chat.fast")
          : option.name;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="min-h-10 gap-2 px-2 py-1.5 text-xs">
        <Icon className="size-3.5 text-fg-subtle" />
        <span>{label}</span>
        <span className="ml-auto max-w-[120px] truncate text-fg-subtle">
          {selectedConfigOptionLabel(option)}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent sideOffset={6} className="w-[280px]">
        {option.type === "select" ? (
          flattenSelectOptions(option).map((item) => (
            <SessionRunItem
              key={`${option.id}:${item.value}`}
              icon={Icon}
              label={item.name}
              hint={
                item.groupName ??
                item.description ??
                option.description ??
                option.name
              }
              active={item.value === option.currentValue}
              onSelect={() => onSetConfigOption(option.id, item.value)}
            />
          ))
        ) : (
          <SessionRunItem
            icon={Icon}
            label={option.name}
            hint={
              option.description ?? (option.currentValue ? "On" : "Off")
            }
            active={option.currentValue}
            onSelect={() =>
              onSetConfigOption(option.id, !option.currentValue)
            }
          />
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function SessionRunSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border/50 py-1 last:border-b-0">
      <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function configOptionIcon(option: AcpSessionConfigOption): LucideIcon {
  switch (option.category) {
    case "model":
      return BrainIcon;
    case "mode":
      return WrenchIcon;
    case "thought_level":
      return EyeIcon;
    default:
      return ZapIcon;
  }
}

export function PermissionModeChip({
  disabled,
  agentId,
  configOptions,
  onSetConfigOption,
}: {
  disabled: boolean;
  agentId: string;
  configOptions?: AcpSessionConfigOption[];
  onSetConfigOption?: (
    configId: string,
    value: string | boolean,
  ) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const settings = useSettings();
  const sessionMode = findModeConfigOption(configOptions);
  if (sessionMode) {
    return (
      <SessionModeControl
        disabled={disabled}
        agentId={agentId}
        option={sessionMode}
        onSetConfigOption={onSetConfigOption}
      />
    );
  }
  const mode = settings?.default.permission_mode ?? "ask";

  const pick = async (next: "ask" | "auto" | "read_only") => {
    if (!settings) return;
    await window.backchat.settingsPatch({
      default: { ...settings.default, permission_mode: next },
    });
  };

  const meta = MODE_META[mode];
  const Icon = meta.icon;
  const label = t(meta.labelKey);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 text-xs",
          meta.toneClass,
          "hover:bg-bg-surface/60",
          "focus:outline-none focus:bg-bg-surface/60",
          "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        )}
        style={{ height: "32px" }}
        aria-label={label}
      >
        <Icon className="size-3.5" />
        <span>{label}</span>
        <ChevronDownIcon className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="min-w-[220px]"
      >
        {(["auto", "ask", "read_only"] as const).map((nextMode) => {
          const item = MODE_META[nextMode];
          const ItemIcon = item.icon;
          const itemLabel = t(item.labelKey);
          return (
            <DropdownMenuItem
              key={nextMode}
              onSelect={() => void pick(nextMode)}
              className="flex items-start gap-2 text-xs"
            >
              <ItemIcon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  item.toneClass,
                )}
              />
              <div className="min-w-0 flex-1">
                <div className={cn(nextMode === mode && "text-fg")}>
                  {itemLabel}
                </div>
                <div className="text-[11px] text-fg-subtle">
                  {t(item.hintKey)}
                </div>
              </div>
              {nextMode === mode && (
                <CheckIcon className="mt-0.5 size-3.5 text-fg-muted" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const CODEX_MODE_TRANSLATIONS: Record<
  string,
  { label: TranslationKey; hint: TranslationKey }
> = {
  "read-only": {
    label: "permission.codexAsk",
    hint: "permission.codexAskHint",
  },
  agent: {
    label: "permission.codexApprove",
    hint: "permission.codexApproveHint",
  },
  "agent-full-access": {
    label: "permission.codexFull",
    hint: "permission.codexFullHint",
  },
};

function SessionModeControl({
  disabled,
  agentId,
  option,
  onSetConfigOption,
}: {
  disabled: boolean;
  agentId: string;
  option: AcpSessionConfigOption & { type: "select" };
  onSetConfigOption?: (
    configId: string,
    value: string | boolean,
  ) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const settings = useSettings();
  const values = flattenSelectOptions(option);
  const selected =
    values.find((item) => item.value === option.currentValue) ?? values[0];
  if (!selected) return null;
  const selectedPresentation = localizedSessionModePresentation(
    t,
    agentId,
    selected,
  );
  const SelectedIcon = sessionModeIcon(selected.value);

  const pick = async (value: string) => {
    await onSetConfigOption?.(option.id, value);
    if (settings && settings.default.permission_mode !== "ask") {
      await window.backchat.settingsPatch({
        default: { ...settings.default, permission_mode: "ask" },
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || !onSetConfigOption}
        className={cn(
          "inline-flex h-8 max-w-[180px] shrink-0 items-center gap-1 rounded-md px-2 text-xs",
          "hover:bg-bg-surface/60 focus:outline-none focus:bg-bg-surface/60",
          "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          selectedPresentation.tone === "warning"
            ? "text-warning"
            : "text-fg-muted",
        )}
        aria-label={selectedPresentation.label}
        title={selectedPresentation.hint}
      >
        <SelectedIcon className="size-3.5 shrink-0" />
        <span className="truncate">{selectedPresentation.label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[360px] p-2"
      >
        {values.map((item) => {
          const presentation = localizedSessionModePresentation(
            t,
            agentId,
            item,
          );
          const ItemIcon = sessionModeIcon(item.value);
          return (
            <DropdownMenuItem
              key={item.value}
              onSelect={() => void pick(item.value)}
              className={cn(
                "min-h-14 items-start gap-3 rounded-lg px-3 py-2",
                presentation.tone === "warning" && "text-warning",
              )}
            >
              <ItemIcon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm">{presentation.label}</div>
                {presentation.hint && (
                  <div className="mt-0.5 text-xs leading-5 text-fg-subtle">
                    {presentation.hint}
                  </div>
                )}
              </div>
              {item.value === option.currentValue && (
                <CheckIcon className="mt-0.5 size-4 shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function localizedSessionModePresentation(
  t: (key: TranslationKey) => string,
  agentId: string,
  option: { value: string; name: string; description?: string | null },
) {
  const presentation = configModeOptionPresentation(agentId, option);
  const translation =
    agentId === "codex-acp"
      ? CODEX_MODE_TRANSLATIONS[option.value]
      : undefined;
  return translation
    ? {
        ...presentation,
        label: t(translation.label),
        hint: t(translation.hint),
      }
    : presentation;
}

function sessionModeIcon(value: string): LucideIcon {
  if (value === "read-only") return HandIcon;
  if (value === "agent") return ShieldCheckIcon;
  if (value === "agent-full-access") return ShieldAlertIcon;
  return ShieldCheckIcon;
}

export function PlanSessionState({
  configOptions,
}: {
  configOptions?: AcpSessionConfigOption[];
}) {
  const { t } = useI18n();
  const option = findSelectConfigOption(configOptions, "collaboration_mode");
  if (!option || option.currentValue !== "plan") return null;
  return (
    <span
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted"
      title={t("chat.planActiveHint")}
    >
      <LightbulbIcon className="size-3.5" />
      <span>{t("chat.plan")}</span>
    </span>
  );
}

export function InlineComposerOptionControls({
  disabled,
  configOptions,
  onSetConfigOption,
}: {
  disabled: boolean;
  configOptions?: AcpSessionConfigOption[];
  onSetConfigOption?: (
    configId: string,
    value: string | boolean,
  ) => void | Promise<void>;
}) {
  const options = buildComposerConfigOptions(configOptions);
  if (options.length === 0) return null;
  return (
    <>
      {options.map((option) => (
        <InlineComposerOptionControl
          key={option.id}
          disabled={disabled}
          option={option}
          onSetConfigOption={onSetConfigOption}
        />
      ))}
    </>
  );
}

function InlineComposerOptionControl({
  disabled,
  option,
  onSetConfigOption,
}: {
  disabled: boolean;
  option: AcpSessionConfigOption;
  onSetConfigOption?: (
    configId: string,
    value: string | boolean,
  ) => void | Promise<void>;
}) {
  if (option.type === "boolean") {
    return (
      <button
        type="button"
        disabled={disabled || !onSetConfigOption}
        aria-pressed={option.currentValue}
        onClick={() => void onSetConfigOption?.(option.id, !option.currentValue)}
        className={cn(
          "inline-flex h-8 max-w-[150px] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs",
          option.currentValue
            ? "bg-bg-surface text-fg"
            : "text-fg-muted hover:bg-bg-surface/60",
        )}
      >
        <CheckSquareIcon className="size-3.5 shrink-0" />
        <span className="truncate">{option.name}</span>
      </button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || !onSetConfigOption}
        className="inline-flex h-8 max-w-[180px] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted hover:bg-bg-surface/60"
      >
        <WrenchIcon className="size-3.5 shrink-0" />
        <span className="truncate">{option.name}</span>
        <span className="truncate text-fg-subtle">
          {selectedConfigOptionLabel(option)}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[260px]">
        {flattenSelectOptions(option).map((item) => (
          <SessionRunItem
            key={item.value}
            label={item.name}
            hint={item.description ?? option.description ?? option.name}
            active={item.value === option.currentValue}
            onSelect={() => onSetConfigOption?.(option.id, item.value)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionRunItem({
  icon: Icon,
  agentId,
  label,
  hint,
  active,
  disabled,
  onSelect,
}: {
  icon?: LucideIcon;
  agentId?: string;
  label: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex items-start gap-2 px-2 py-1.5 text-xs",
        active && "text-fg",
      )}
    >
      {agentId ? (
        <AgentIcon
          agentId={agentId}
          className="mt-0.5 size-3.5 shrink-0 text-fg-subtle"
        />
      ) : Icon ? (
        <Icon className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && (
          <span className="block truncate text-[11px] text-fg-subtle">
            {hint}
          </span>
        )}
      </span>
      {active && (
        <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
      )}
    </DropdownMenuItem>
  );
}

const MODE_META: Record<
  "ask" | "auto" | "read_only",
  {
    icon: typeof ShieldAlertIcon;
    labelKey: TranslationKey;
    hintKey: TranslationKey;
    toneClass: string;
  }
> = {
  ask: {
    icon: ShieldAlertIcon,
    labelKey: "permission.ask",
    hintKey: "permission.askHint",
    toneClass: "text-fg-muted",
  },
  auto: {
    icon: ZapIcon,
    labelKey: "permission.auto",
    hintKey: "permission.autoHint",
    toneClass: "text-warning",
  },
  read_only: {
    icon: EyeIcon,
    labelKey: "permission.readOnly",
    hintKey: "permission.readOnlyHint",
    toneClass: "text-fg-muted",
  },
};
