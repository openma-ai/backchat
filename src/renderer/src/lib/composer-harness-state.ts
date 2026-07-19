import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AgentInfo } from "@shared/api.js";
import type { AgentMessageIntent } from "@shared/agent-interaction.js";
import type { Settings } from "@shared/settings.js";
import { describeRunningMessageAction } from "./composer-delivery";
import { enabledAgentIds, isAgentRunnable } from "./enabled-agents";
import { isComposerAgentLocked } from "./composer-agent";
import {
  applyConfigOverrides,
  normalizeAgentConfigOptions,
  type AcpSessionConfigOption,
} from "./session-config-options";
import {
  normalizeAgentAvailableCommands,
  withSessionStateCommands,
} from "./composer-slash-commands";
import type { AcpAvailableCommand } from "./session-store";
import { useSettings } from "./settings-store";
import {
  configValuesFromOptions,
  readRecentRunPreferences,
  recentConfigOverrides,
  recordRecentRunPreferences,
} from "./recent-run-preferences";

export interface ComposerHarnessState {
  enabledAgents: AgentInfo[];
  agentLocked: boolean;
  currentAgentId: string;
  currentAgent?: AgentInfo;
  currentEnabledAgent?: AgentInfo;
  hasHarnessSetup: boolean;
}

export function deriveComposerHarnessState({
  agents,
  settings,
  sessionAgentId,
  lockedAgentId,
  pickedAgentId,
  recentAgentId,
  agentPickerLabel,
}: {
  agents: readonly AgentInfo[];
  settings: Settings | null | undefined;
  sessionAgentId?: string | null;
  lockedAgentId?: string | null;
  pickedAgentId?: string | null;
  recentAgentId?: string | null;
  agentPickerLabel?: string;
}): ComposerHarnessState {
  const enabledIds = enabledAgentIds(settings);
  const enabledAgents = agents.filter(
    (agent) => enabledIds.has(agent.id) && isAgentRunnable(agent),
  );
  const agentLocked = isComposerAgentLocked(sessionAgentId);
  const runnableRecentAgentId = enabledAgents.some(
    (agent) => agent.id === recentAgentId,
  )
    ? recentAgentId
    : null;
  const currentAgentId =
    lockedAgentId
    || pickedAgentId
    || sessionAgentId
    || runnableRecentAgentId
    || enabledAgents[0]?.id
    || "";
  const currentAgent = agents.find((agent) => agent.id === currentAgentId);
  const currentEnabledAgent = enabledAgents.find(
    (agent) => agent.id === currentAgentId,
  );

  return {
    enabledAgents,
    agentLocked,
    currentAgentId,
    currentAgent,
    currentEnabledAgent,
    hasHarnessSetup:
      !!agentPickerLabel || !!lockedAgentId || !!currentEnabledAgent,
  };
}

export function useComposerHarnessState({
  sessionAgentId,
  lockedAgentId,
  pickedAgentId,
  agentPickerLabel,
  configOptions,
  availableCommands,
  running,
}: {
  sessionAgentId?: string;
  lockedAgentId: string | null;
  pickedAgentId: string | null;
  agentPickerLabel?: string;
  configOptions?: AcpSessionConfigOption[];
  availableCommands?: AcpAvailableCommand[];
  running: boolean | undefined;
}) {
  const [draftConfigValues, setDraftConfigValues] = useState<
    Record<string, string | boolean>
  >({});
  const [recentPreferences, setRecentPreferences] = useState(
    readRecentRunPreferences,
  );
  const settings = useSettings();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => window.backchat.agentsList(),
    staleTime: 60_000,
  });
  const harness = useMemo(
    () =>
      deriveComposerHarnessState({
        agents,
        settings,
        sessionAgentId,
        lockedAgentId,
        pickedAgentId,
        recentAgentId: recentPreferences.agentId,
        agentPickerLabel,
      }),
    [
      agentPickerLabel,
      agents,
      lockedAgentId,
      pickedAgentId,
      recentPreferences.agentId,
      sessionAgentId,
      settings,
    ],
  );
  const baseConfigOptions = useMemo(
    () =>
      configOptions
      ?? normalizeAgentConfigOptions(
        harness.currentEnabledAgent?.config_options,
      ),
    [configOptions, harness.currentEnabledAgent?.config_options],
  );
  const effectiveConfigOptions = useMemo(
    () =>
      applyConfigOverrides(
        baseConfigOptions,
        draftConfigValues,
      ),
    [
      baseConfigOptions,
      draftConfigValues,
    ],
  );
  const effectiveAvailableCommands = useMemo(
    () =>
      withSessionStateCommands(
        availableCommands
          ?? normalizeAgentAvailableCommands(
            harness.currentEnabledAgent?.available_commands,
          ),
        effectiveConfigOptions,
        harness.currentAgentId,
      ),
    [
      availableCommands,
      effectiveConfigOptions,
      harness.currentAgentId,
      harness.currentEnabledAgent?.available_commands,
    ],
  );
  const defaultRunningAction = running
    ? describeRunningMessageAction({
        agentId: harness.currentAgentId,
        intent: "submit",
      })
    : null;
  const primaryIntent: AgentMessageIntent =
    running && defaultRunningAction?.disabled ? "queue" : "submit";
  const primaryRunningAction = running
    ? describeRunningMessageAction({
        agentId: harness.currentAgentId,
        intent: primaryIntent,
      })
    : null;

  useEffect(() => {
    setDraftConfigValues(
      lockedAgentId
        ? {}
        : recentConfigOverrides(
            recentPreferences,
            harness.currentAgentId,
            baseConfigOptions,
          ),
    );
  }, [
    baseConfigOptions,
    harness.currentAgentId,
    lockedAgentId,
    recentPreferences,
  ]);

  const rememberCurrentRun = () => {
    if (!harness.currentEnabledAgent?.id) return;
    setRecentPreferences(
      recordRecentRunPreferences({
        agentId: harness.currentEnabledAgent.id,
        configValues: configValuesFromOptions(effectiveConfigOptions),
      }),
    );
  };

  return {
    ...harness,
    draftConfigValues,
    effectiveAvailableCommands,
    effectiveConfigOptions,
    primaryIntent,
    primaryRunningAction,
    rememberCurrentRun,
    resetDraftConfigValues: () => setDraftConfigValues({}),
    setDraftConfigValues,
  };
}
