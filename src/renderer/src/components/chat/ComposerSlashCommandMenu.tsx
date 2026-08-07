import {
  ArrowRightFromLineIcon,
  BrainIcon,
  BoxIcon,
  BugIcon,
  CircleGaugeIcon,
  CloudIcon,
  CommandIcon,
  CornerDownLeftIcon,
  FilePlus2Icon,
  GaugeIcon,
  LightbulbIcon,
  MessageCirclePlusIcon,
  MessageSquareTextIcon,
  PawPrintIcon,
  PlugZapIcon,
  TargetIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "@/lib/i18n";
import {
  isHostForkSlashCommand,
  skillCommandLabel,
  type SlashCommandSection,
} from "@/lib/composer-slash-commands";
import type { AcpAvailableCommand } from "@/lib/session-store";

const COMMAND_ICONS: Record<string, LucideIcon> = {
  compact: CircleGaugeIcon,
  cloud: CloudIcon,
  continue: ArrowRightFromLineIcon,
  "continue-in-new-chat": ArrowRightFromLineIcon,
  feedback: MessageSquareTextIcon,
  fast: ZapIcon,
  goal: TargetIcon,
  init: FilePlus2Icon,
  mcp: PlugZapIcon,
  memories: BrainIcon,
  new: MessageCirclePlusIcon,
  "new-chat": MessageCirclePlusIcon,
  pet: PawPrintIcon,
  plan: LightbulbIcon,
  "plan-mode": LightbulbIcon,
  side: MessageCirclePlusIcon,
  status: GaugeIcon,
};

function commandIconFor(
  command: AcpAvailableCommand,
  sectionKind: "commands" | "skills",
): LucideIcon {
  if (sectionKind === "skills") return BoxIcon;
  const normalizedName = command.name.trim().toLowerCase();
  if (/^review(?:-|$)/.test(normalizedName)) return BugIcon;
  return COMMAND_ICONS[normalizedName] ?? CommandIcon;
}

export function ComposerSlashCommandMenu({
  sections,
  selectedIndex,
  onHighlight,
  onPick,
}: {
  sections: readonly SlashCommandSection[];
  selectedIndex: number;
  onHighlight: (index: number) => void;
  onPick: (command: AcpAvailableCommand) => void;
}) {
  const { t } = useI18n();
  const visibleCommands = sections.flatMap((section) => section.commands);

  return (
    <div
      className="composer-action-panel slash-command-panel composer-overlay-panel liquid-glass composer-card absolute bottom-full z-30"
      role="listbox"
      aria-label={t("chat.slashCommands")}
    >
      {sections.map((section) => (
        <div
          key={section.kind}
          className="slash-command-section"
          role="presentation"
        >
          {section.kind === "skills" && (
            <div className="slash-command-section-label" aria-hidden="true">
              <span>{t("chat.skills")}</span>
            </div>
          )}
          {section.commands.map((command) => {
            const index = visibleCommands.indexOf(command);
            const CommandIconComponent = commandIconFor(command, section.kind);
            const isHostFork = isHostForkSlashCommand(command);
            const primaryLabel = isHostFork
              ? command.description ?? command.name
              : section.kind === "skills"
                ? skillCommandLabel(command)
                : `/${command.name}`;
            const secondaryDescription = isHostFork
              ? typeof command.metadata?.description === "string"
                ? command.metadata.description
                : undefined
              : command.description;
            return (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-label={`${primaryLabel}${secondaryDescription ? ` — ${secondaryDescription}` : ""}`}
                aria-selected={index === selectedIndex}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onPick(command)}
                className="slash-command-item"
              >
                <span
                  className="slash-command-icon"
                  data-command-icon={command.name}
                  aria-hidden="true"
                >
                  <CommandIconComponent className="size-4" />
                </span>
                <span className="slash-command-main">
                  <code className="slash-command-token">{primaryLabel}</code>
                  {command.input?.hint && (
                    <span className="slash-command-hint">
                      {command.input.hint}
                    </span>
                  )}
                </span>
                {secondaryDescription && (
                  <span
                    className="slash-command-description"
                    title={secondaryDescription}
                  >
                    {secondaryDescription}
                  </span>
                )}
                <CornerDownLeftIcon
                  className="slash-command-enter size-3.5"
                  aria-hidden="true"
                />
              </button>
            );
          })}
          {section.hiddenCount > 0 && (
            <div className="slash-command-more">
              <span>{section.hiddenCount}</span>
              <span>{t("chat.moreSkills")}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
