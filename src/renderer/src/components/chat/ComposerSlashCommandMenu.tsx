import { CornerDownLeftIcon, SlashIcon, ZapIcon } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { SlashCommandSection } from "@/lib/composer-slash-commands";
import type { AcpAvailableCommand } from "@/lib/session-store";

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
      className="slash-command-panel absolute left-3 right-3 bottom-full z-30"
      role="listbox"
      aria-label={t("chat.slashCommands")}
    >
      {sections.map((section) => (
        <div
          key={section.kind}
          className="slash-command-section"
          role="presentation"
        >
          <div className="slash-command-section-label" aria-hidden="true">
            {section.kind === "skills" ? (
              <ZapIcon className="size-3" />
            ) : (
              <SlashIcon className="size-3" />
            )}
            <span>
              {section.kind === "skills"
                ? t("chat.skills")
                : t("chat.commands")}
            </span>
          </div>
          {section.commands.map((command) => {
            const index = visibleCommands.indexOf(command);
            return (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-label={`/${command.name}${command.description ? ` — ${command.description}` : ""}`}
                aria-selected={index === selectedIndex}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onPick(command)}
                className="slash-command-item"
              >
                <span className="slash-command-icon" aria-hidden="true">
                  {section.kind === "skills" ? (
                    <ZapIcon className="size-3.5" />
                  ) : (
                    <SlashIcon className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <code className="slash-command-token">
                      {`/${command.name}`}
                    </code>
                    {command.input?.hint && (
                      <span className="slash-command-hint">
                        {command.input.hint}
                      </span>
                    )}
                  </span>
                  {command.description && (
                    <span className="slash-command-description">
                      {command.description}
                    </span>
                  )}
                </span>
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
