import {
  BrainIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  CloudIcon,
  EyeIcon,
  HandIcon,
  LightbulbIcon,
  MonitorIcon,
  RotateCcwIcon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TargetIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
  LogInIcon,
  RefreshCwIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentIcon } from "@/components/AgentIcon";
import {
  buildComposerConfigOptions,
  buildRunMenuConfigOptionSections,
  configModeOptionPresentation,
  findModeConfigOption,
  flattenSelectOptions,
  isAgentPresetConfigOption,
  isFastModeConfigOption,
  selectedConfigOptionLabel,
  type AcpSessionConfigOption,
} from "@/lib/session-config-options";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { ComposerSessionStatePresentation } from "@/lib/composer-session-state";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import {
  agentPresetIcon,
  DshPresetStandardIcon,
  type DshPresetIcon,
} from "./dsh-preset-icons";

export type ComposerAgentOption = {
  id: string;
  label: string;
  icon?: string;
  command: string;
  detected: boolean;
  installed?: boolean;
};

export type ComposerRuntimeKind = "local" | "cloud" | "remote";

const COMPOSER_ICON_BUTTON_CLASS = cn(
  "inline-flex size-[var(--control-height-compact)] shrink-0 items-center justify-center rounded-md",
  "text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg",
  "disabled:text-fg-subtle/40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle/40",
  "transition-colors",
);

/** Toolbar chips stay transparent at rest. Hover and an open menu wash;
 * leftover :focus-visible after closing the menu must not look selected. */
const COMPOSER_TOOLBAR_CHIP_CLASS = cn(
  "inline-flex h-7 shrink-0 select-none items-center gap-1 rounded-md bg-transparent px-1.5 text-xs",
  "appearance-none shadow-none",
  "hover:bg-[var(--control-bg-hover)]",
  "focus:outline-none",
  "data-[state=open]:bg-[var(--control-bg-open)] data-[state=open]:text-fg",
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
);

export function ComposerAuthControls({
  authNeeded,
  refreshing = false,
  onSignIn,
  onRefresh,
}: {
  authNeeded: boolean;
  refreshing?: boolean;
  onSignIn: () => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  if (!authNeeded) return null;
  return (
    <>
      <button
        type="button"
        data-composer-auth-refresh="true"
        aria-label={t("chat.refreshAuth")}
        disabled={refreshing}
        onClick={onRefresh}
        className={COMPOSER_ICON_BUTTON_CLASS}
      >
        <RefreshCwIcon className="size-3.5" />
      </button>
      <button
        type="button"
        data-composer-auth-signin="true"
        onClick={onSignIn}
        disabled={refreshing}
        className={cn(
          "inline-flex h-[var(--control-height-compact)] shrink-0 items-center gap-1 rounded-md px-1.5",
          "text-xs text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg",
          "disabled:text-fg-subtle/40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle/40",
          "transition-colors",
        )}
      >
        <LogInIcon className="size-3.5" />
        <span>{t("chat.signIn")}</span>
      </button>
    </>
  );
}

export function runtimePresentation(kind: ComposerRuntimeKind): {
  Icon: LucideIcon;
  labelKey: TranslationKey;
} {
  switch (kind) {
    case "cloud":
      return { Icon: CloudIcon, labelKey: "chat.cloud" };
    case "remote":
      return { Icon: ServerIcon, labelKey: "chat.otherMachine" };
    default:
      return { Icon: MonitorIcon, labelKey: "chat.local" };
  }
}

export function SessionRunChip({
  disabled,
  locked,
  agents,
  currentAgentId,
  currentAgentLabel,
  runtimeKind = "local",
  configOptions,
  onPickAgent,
  onSetConfigOption,
  onResetConfigOptions,
  authNeeded = false,
}: {
  disabled: boolean;
  locked: boolean;
  agents: ComposerAgentOption[];
  currentAgentId: string;
  currentAgentLabel?: string;
  runtimeKind?: ComposerRuntimeKind;
  onPickAgent: (agentId: string) => void;
  configOptions?: AcpSessionConfigOption[];
  onSetConfigOption: (configId: string, value: string | boolean) => void;
  onResetConfigOptions?: () => void;
  authNeeded?: boolean;
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
  const { labelKey: runtimeLabelKey } =
    runtimePresentation(runtimeKind);
  const runtimeLabel = t(runtimeLabelKey);
  // The tooltip repeats the chip's own label, so it only earns its place
  // when the label is actually truncated. Hover is the only trigger; the
  // measurement happens as the pointer arrives.
  const labelRef = useRef<HTMLSpanElement>(null);
  const [labelTruncated, setLabelTruncated] = useState(false);
  const refreshLabelTruncation = useCallback(() => {
    const label = labelRef.current;
    setLabelTruncated(!!label && label.scrollWidth > label.clientWidth);
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        data-composer-run-trigger="true"
        className={cn(
          "app-compact-control group/model-selector inline-flex max-w-[250px] items-center pl-[var(--control-padding-inline)] text-xs",
          "select-none bg-transparent",
          "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          authNeeded && "text-danger",
        )}
        aria-label={
          noHarnessSetup
            ? `Run on ${runtimeLabel} with no harness setup`
            : `Run on ${runtimeLabel} with ${agentLabel} using ${configLabel}`
        }
      >
        {noHarnessSetup ? (
          <span className={cn("shrink-0", authNeeded && "text-danger")}>{agentLabel}</span>
        ) : (
          <>
            <span
              data-composer-run-harness="true"
              className={cn("flex shrink-0 items-center", authNeeded && "text-danger")}
            >
              <AgentIcon
                agentId={currentAgentId}
                iconUrl={agents.find((agent) => agent.id === currentAgentId)?.icon}
                className="size-3.5 shrink-0"
                title={agentLabel}
              />
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    ref={labelRef}
                    onMouseEnter={refreshLabelTruncation}
                    className={cn("min-w-0 max-w-[140px] truncate", authNeeded && "text-danger")}
                  >
                    {configLabel}
                  </span>
                </TooltipTrigger>
                {labelTruncated && (
                  <TooltipContent side="top">{configLabel}</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-current opacity-65 group-hover/model-selector:text-fg group-hover/model-selector:opacity-100" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[var(--composer-menu-width)]">
        <div className="border-b border-border/50 py-1">
          <SessionAgentSubmenu
            agents={agents}
            currentAgentId={currentAgentId}
            currentAgentLabel={agentLabel}
            locked={locked}
            onPickAgent={onPickAgent}
            onOpenSettings={() => void navigate({ to: "/settings/agents" })}
          />
        </div>

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
        {configSections.length > 0 && onResetConfigOptions && (
          <DropdownMenuItem
            className="min-h-10 gap-2 px-2 py-1.5 text-xs text-fg-muted"
            onSelect={onResetConfigOptions}
          >
            <RotateCcwIcon className="size-3.5 text-fg-subtle" />
            <span>{t("chat.resetToDefault")}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionAgentSubmenu({
  agents,
  currentAgentId,
  currentAgentLabel,
  locked,
  onPickAgent,
  onOpenSettings,
}: {
  agents: ComposerAgentOption[];
  currentAgentId: string;
  currentAgentLabel: string;
  locked: boolean;
  onPickAgent: (agentId: string) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="min-h-10 gap-2 px-2 py-1.5 text-xs">
        {agents.length > 0 ? (
          <AgentIcon
            agentId={currentAgentId}
            iconUrl={agents.find((agent) => agent.id === currentAgentId)?.icon}
            className="size-3.5 text-fg-subtle"
            title={currentAgentLabel}
          />
        ) : (
          <TerminalIcon className="size-3.5 text-fg-subtle" />
        )}
        <span>{t("chat.harness")}</span>
        <span className="ml-auto max-w-[120px] truncate text-fg-subtle">
          {currentAgentLabel}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent sideOffset={6} className="w-[var(--composer-menu-width)]">
        {agents.length > 0 ? (
          agents.map((agent) => (
            <SessionRunItem
              key={agent.id}
              agentId={agent.id}
              agentIconUrl={agent.icon}
              label={agent.label}
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
            onSelect={onOpenSettings}
          />
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
        : isFastModeConfigOption(option)
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
      <DropdownMenuSubContent sideOffset={6} className="w-[var(--composer-menu-width)]">
        {option.type === "select" ? (
          flattenSelectOptions(option).map((item) => (
            <SessionRunItem
              key={`${option.id}:${item.value}`}
              icon={
                isAgentPresetConfigOption(option)
                  ? agentPresetIcon(item.value)
                  : Icon
              }
              label={item.name}
              hint={
                isAgentPresetConfigOption(option)
                  ? undefined
                  : item.groupName ??
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

function configOptionIcon(option: AcpSessionConfigOption): LucideIcon | DshPresetIcon {
  if (isAgentPresetConfigOption(option)) return DshPresetStandardIcon;
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
        className={cn(COMPOSER_TOOLBAR_CHIP_CLASS, meta.toneClass)}
        aria-label={label}
      >
        <Icon className="size-3.5" />
        <span>{label}</span>
        <ChevronDownIcon className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[var(--composer-menu-width)]"
        onCloseAutoFocus={(event) => event.preventDefault()}
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
          COMPOSER_TOOLBAR_CHIP_CLASS,
          "max-w-[180px]",
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
        className="w-[var(--composer-menu-width)] p-1"
        onCloseAutoFocus={(event) => event.preventDefault()}
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
                "min-h-12 items-start gap-2 rounded-md px-2 py-1.5",
                presentation.tone === "warning" && "text-warning",
              )}
            >
              <ItemIcon className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs">{presentation.label}</div>
                {presentation.hint && (
                  <div className="mt-0.5 text-[11px] leading-4 text-fg-subtle">
                    {presentation.hint}
                  </div>
                )}
              </div>
              {item.value === option.currentValue && (
                <CheckIcon className="mt-0.5 size-3.5 shrink-0" />
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

export function ComposerSessionStateSlot({
  presentation,
  onClear,
  clearLabel,
}: {
  presentation?: ComposerSessionStatePresentation;
  onClear?: () => void;
  clearLabel?: string;
}) {
  if (!presentation) return null;
  const Icon =
    presentation.icon === "plan" ? LightbulbIcon : TargetIcon;
  if (onClear) {
    // Dismissible state reads as one pill: at rest it shows its own icon;
    // hovering swaps the icon slot for a filled ⊗ and the whole chip is
    // the exit button — no second affordance appears beside it.
    return (
      <button
        type="button"
        aria-label={clearLabel}
        title={clearLabel}
        onClick={onClear}
        data-composer-session-state="true"
        data-composer-session-state-clear="true"
        data-session-state-kind={presentation.kind}
        className="group/session-state inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-fg-muted transition-colors hover:bg-[var(--control-bg-hover)] hover:text-fg focus-visible:bg-[var(--control-bg-hover)] focus-visible:text-fg"
      >
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          <Icon
            aria-hidden="true"
            className="size-3.5 transition-opacity group-hover/session-state:opacity-0 group-focus-visible/session-state:opacity-0"
          />
          <span
            aria-hidden="true"
            data-session-state-clear-glyph="true"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-fg-muted text-bg opacity-0 transition-opacity group-hover/session-state:opacity-100 group-focus-visible/session-state:opacity-100"
          >
            <XIcon className="size-2.5" strokeWidth={3} />
          </span>
        </span>
        <span>{presentation.label}</span>
      </button>
    );
  }
  return (
    <span
      data-composer-session-state="true"
      data-session-state-kind={presentation.kind}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-fg-muted"
      title={presentation.title}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{presentation.label}</span>
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
          "inline-flex h-7 max-w-[150px] shrink-0 select-none items-center gap-1 rounded-md px-1.5 text-xs",
          option.currentValue
            ? "bg-[var(--control-bg-open)] text-fg"
            : "text-fg-muted hover:bg-[var(--control-bg-hover)]",
        )}
      >
        <CheckSquareIcon className="size-3.5 shrink-0" />
        <span className="truncate">{option.name}</span>
      </button>
    );
  }
  const currentLabel = selectedConfigOptionLabel(option);
  if (isAgentPresetConfigOption(option)) {
    const SelectedIcon = agentPresetIcon(option.currentValue);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled || !onSetConfigOption}
          aria-label={currentLabel}
          className={cn(
            COMPOSER_TOOLBAR_CHIP_CLASS,
            "max-w-[180px] text-fg-muted",
          )}
        >
          <SelectedIcon className="size-3.5 shrink-0" />
          <span className="truncate">{currentLabel}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-[var(--composer-menu-width)] p-1"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {flattenSelectOptions(option).map((item) => {
            const ItemIcon = agentPresetIcon(item.value);
            return (
              <SessionRunItem
                key={item.value}
                icon={ItemIcon}
                label={item.name}
                active={item.value === option.currentValue}
                onSelect={() => onSetConfigOption?.(option.id, item.value)}
              />
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || !onSetConfigOption}
        className={cn(
          COMPOSER_TOOLBAR_CHIP_CLASS,
          "max-w-[180px] text-fg-muted",
        )}
      >
        <WrenchIcon className="size-3.5 shrink-0" />
        <span className="truncate">{option.name}</span>
        <span className="truncate text-fg-subtle">
          {selectedConfigOptionLabel(option)}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[260px]"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
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
  agentIconUrl,
  label,
  hint,
  active,
  disabled,
  onSelect,
}: {
  icon?: LucideIcon | DshPresetIcon;
  agentId?: string;
  agentIconUrl?: string;
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
        <span aria-hidden="true" className="mt-0.5 shrink-0">
          <AgentIcon
            agentId={agentId}
            iconUrl={agentIconUrl}
            className="size-3.5 text-fg-subtle"
          />
        </span>
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
