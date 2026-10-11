import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AgentInfo } from "@shared/api";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";
import { canOfferAuthLogout } from "@/lib/auth-method-menu";
import { deriveComposerHarnessState } from "@/lib/composer-harness-state";
import { readRecentRunPreferences } from "@/lib/recent-run-preferences";
import { sessionStore } from "@/lib/session-store";
import type { SessionRow } from "@/lib/session-types";
import { useSettings } from "@/lib/settings-store";
import { AgentAuthSetupPanel } from "@/pages/settings/AgentSettingsPanels";

export function ComposerAuthSetup({
  sessionId,
  sessionAgentId,
  pickedAgentId,
  authRequired,
  sessionAuth,
  sessionSupportsLogout = false,
  open = false,
  onClose,
  onAuthenticated,
}: {
  sessionId?: string;
  sessionAgentId?: string;
  pickedAgentId?: string | null;
  authRequired?: boolean;
  sessionAuth?: SessionRow["auth"];
  /** Live ACP connection advertised `agentCapabilities.auth.logout`. */
  sessionSupportsLogout?: boolean;
  open?: boolean;
  onClose?: () => void;
  onAuthenticated?: () => Promise<void>;
}) {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [selectedMethodId, setSelectedMethodId] = useState<string | undefined>();
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string>();
  const { data: agents = [] } = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: () => window.backchat.agentsList(),
    staleTime: 60_000,
  });
  const harness = deriveComposerHarnessState({
    agents,
    settings,
    sessionAgentId,
    pickedAgentId,
    recentAgentId: readRecentRunPreferences().agentId,
  });
  const agent = overlayAgentAuth(harness.currentAgent, sessionAuth);
  const finishAuthentication = async () => {
    setReconnecting(true);
    setRecoveryError(undefined);
    try {
      await onAuthenticated?.();
      if (sessionId && !onAuthenticated) sessionStore.clearAuthRequired(sessionId);
      setWaitingForAuth(false);
      onClose?.();
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setReconnecting(false);
    }
  };
  const logout = useMutation({
    mutationFn: () => window.backchat.agentLogout({
      id: harness.currentAgentId,
      ...(sessionId ? { sessionId } : {}),
    }),
    onSuccess: (next) => {
      queryClient.setQueryData(AGENTS_QUERY_KEY, next);
    },
  });
  const auth = useMutation({
    mutationFn: (input: { methodId?: string; values?: Record<string, string> }) =>
      window.backchat.agentAuthenticate({
        id: harness.currentAgentId,
        methodId: input.methodId,
        ...(input.values ? { values: input.values } : {}),
      }),
    onMutate: () => {
      setWaitingForAuth(true);
      setRecoveryError(undefined);
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(AGENTS_QUERY_KEY, next);
      const updated = next.find((item) => item.id === harness.currentAgentId);
      if (updated?.auth?.status === "configured") await finishAuthentication();
    },
    onError: () => {
      setWaitingForAuth(false);
    },
  });

  useEffect(() => {
    setWaitingForAuth(false);
    setSelectedMethodId(undefined);
  }, [harness.currentAgentId, authRequired, sessionAuth?.status]);

  useEffect(() => {
    if (!harness.currentAgentId || !sessionAuth) return;
    queryClient.setQueryData(
      AGENTS_QUERY_KEY,
      (current: AgentInfo[] | undefined) =>
        (current ?? []).map((item) =>
          item.id === harness.currentAgentId
            ? { ...item, auth: { ...item.auth, ...sessionAuth } }
            : item,
        ),
    );
  }, [harness.currentAgentId, queryClient, sessionAuth]);

  if (!open || !settings || !agent) return null;

  const logoutError = logout.error instanceof Error
    ? logout.error.message
    : logout.error
      ? String(logout.error)
      : undefined;
  return (
    <AgentAuthSetupPanel
      agent={agent}
      settings={settings}
      selectedMethodId={selectedMethodId}
      waitingForAuth={waitingForAuth}
      pending={auth.isPending || reconnecting}
      logoutPending={logout.isPending}
      supportsLogout={canOfferAuthLogout(agent, { authRequired, sessionSupportsLogout })}
      error={recoveryError ?? logoutError ?? (auth.error instanceof Error ? auth.error.message : auth.error ? String(auth.error) : undefined)}
      onLogout={() => logout.mutate()}
      onMethodIdChange={setSelectedMethodId}
      onStart={(methodId, options) => auth.mutate({
        methodId,
        values: options?.values,
      })}
      onClose={() => onClose?.()}
      onSaved={() => {
        void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY });
        void finishAuthentication().catch(() => {});
      }}
    />
  );
}

function overlayAgentAuth(
  agent: AgentInfo | undefined,
  sessionAuth: SessionRow["auth"],
): AgentInfo | undefined {
  if (!agent) return undefined;
  if (!sessionAuth) return agent;
  return {
    ...agent,
    auth: {
      ...agent.auth,
      ...sessionAuth,
      methods: sessionAuth.methods ?? agent.auth?.methods,
    },
  };
}
