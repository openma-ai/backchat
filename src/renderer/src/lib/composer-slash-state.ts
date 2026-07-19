import { useEffect, useMemo, useState } from "react";

import type { AcpAvailableCommand } from "./session-store";
import {
  buildSlashCommandSections,
  slashCommandQuery,
} from "./composer-slash-commands";

export function resolveComposerSlashQuery(
  text: string,
  dismissedSlashText: string | null,
): string | null {
  const query = slashCommandQuery(text);
  return query != null && dismissedSlashText !== text ? query : null;
}

export function moveComposerSlashPickerIndex(
  currentIndex: number,
  commandCount: number,
  direction: "next" | "previous",
): number {
  if (commandCount <= 0) return 0;
  const offset = direction === "next" ? 1 : -1;
  return (currentIndex + offset + commandCount) % commandCount;
}

export function reconcileComposerSkillCommand(
  selectedSkillCommand: AcpAvailableCommand | null,
  availableCommands: readonly AcpAvailableCommand[],
): AcpAvailableCommand | null {
  if (!selectedSkillCommand) return null;
  return availableCommands.some(
    (command) => command.name === selectedSkillCommand.name,
  )
    ? selectedSkillCommand
    : null;
}

export function useComposerSlashState({
  text,
  availableCommands,
}: {
  text: string;
  availableCommands: readonly AcpAvailableCommand[];
}) {
  const [dismissedSlashText, setDismissedSlashText] =
    useState<string | null>(null);
  const [selectedSkillCommand, setSelectedSkillCommand] =
    useState<AcpAvailableCommand | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const slashQuery = useMemo(
    () => resolveComposerSlashQuery(text, dismissedSlashText),
    [dismissedSlashText, text],
  );
  const slashCommandSections = useMemo(
    () =>
      slashQuery == null || availableCommands.length === 0
        ? []
        : buildSlashCommandSections(availableCommands, slashQuery),
    [availableCommands, slashQuery],
  );
  const visibleSlashCommands = useMemo(
    () => slashCommandSections.flatMap((section) => section.commands),
    [slashCommandSections],
  );

  useEffect(() => {
    setSelectedSkillCommand((current) =>
      reconcileComposerSkillCommand(current, availableCommands));
  }, [availableCommands]);

  useEffect(() => {
    setPickerIndex(0);
  }, [slashQuery, visibleSlashCommands.length]);

  return {
    clearDismissal: () => setDismissedSlashText(null),
    clearSelectedSkill: () => setSelectedSkillCommand(null),
    dismissPicker: () => setDismissedSlashText(text),
    movePicker: (direction: "next" | "previous") =>
      setPickerIndex((current) =>
        moveComposerSlashPickerIndex(
          current,
          visibleSlashCommands.length,
          direction,
        )),
    pickerIndex,
    selectedSkillCommand,
    selectSkillCommand: (command: AcpAvailableCommand) =>
      setSelectedSkillCommand(command),
    setDismissedSlashText,
    setPickerIndex,
    showPicker: visibleSlashCommands.length > 0,
    slashCommandSections,
    visibleSlashCommands,
  };
}
