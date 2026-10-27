/**
 * One vocabulary for the App update and the managed-agent update.
 *
 * The App update is a three-step flow — check, download, restart — and the
 * managed-agent update is a two-step one — check, upgrade. Both surfaces
 * (Settings → About and the sidebar control) read the same status words so
 * the two halves of the product never sound like two unrelated tools.
 *
 * The App update is deliberately split into three separate user actions.
 * "Check" only discovers; it never downloads. "Download" fetches the bytes
 * the check found. "Restart" installs them. Collapsing any two of those
 * steps is what made "Check for updates" turn into a silent download.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { AgentInfo } from "@shared/api";
import type { AppUpdateState, UpdateProgress } from "@shared/app-update";
import {
  agentUpdateStateFrom,
  type AgentUpdateState,
} from "@shared/agent-update";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";
import type { TranslationKey } from "@/lib/i18n";

export type Translate = (
  key: TranslationKey,
  values?: Record<string, string | number>,
) => string;

/**
 * The shared status words. Every surface labels a row with one of these, so
 * "Update available" means the same thing for the app and for an agent.
 */
export type UpdateStatusLabel =
  | "idle"
  | "checking"
  | "upToDate"
  | "updateAvailable"
  | "downloading"
  | "ready"
  | "upgrading"
  | "restarting"
  | "error";

export interface UpdateSubject {
  /** Shared vocabulary status. */
  status: UpdateStatusLabel;
  /** Secondary line — a version, a count, or an error detail. */
  detail: string | null;
  /** Live progress. Non-null only when a real percentage is known. */
  progress: UpdateProgress | null;
  /** True while the subject is working. */
  busy: boolean;
}

const statusKeys: Record<UpdateStatusLabel, TranslationKey> = {
  idle: "update.status.idle",
  checking: "update.status.checking",
  upToDate: "update.status.upToDate",
  updateAvailable: "update.status.updateAvailable",
  downloading: "update.status.downloading",
  ready: "update.status.ready",
  upgrading: "update.status.upgrading",
  restarting: "update.status.restarting",
  error: "update.status.error",
};

export function updateStatusKey(status: UpdateStatusLabel): TranslationKey {
  return statusKeys[status];
}

function errorKey(state: AppUpdateState): TranslationKey {
  switch (state.errorCode) {
    case "checksum":
      return "update.errorChecksum";
    case "manifest":
      return "update.errorManifest";
    case "install":
      return "update.errorInstall";
    default:
      return "update.errorNetwork";
  }
}

/** The App half of the shared vocabulary. */
export function appUpdateSubject(
  state: AppUpdateState | null,
  t: Translate,
): UpdateSubject {
  if (!state) {
    return { status: "idle", detail: null, progress: null, busy: false };
  }
  switch (state.status) {
    case "checking":
      return { status: "checking", detail: null, progress: null, busy: true };
    case "downloading":
      return {
        status: "downloading",
        detail: null,
        progress: state.progress,
        busy: true,
      };
    case "available":
      return {
        status: "updateAvailable",
        detail: state.available?.version ?? null,
        progress: null,
        busy: false,
      };
    case "ready":
      return {
        status: "ready",
        detail: state.available?.version ?? null,
        progress: null,
        busy: false,
      };
    case "upToDate":
      return {
        status: "upToDate",
        detail: state.version,
        progress: null,
        busy: false,
      };
    case "installing":
      return { status: "restarting", detail: null, progress: null, busy: true };
    case "error":
      return {
        status: "error",
        detail: t(errorKey(state)),
        progress: null,
        busy: false,
      };
    default:
      return {
        status: "idle",
        detail: state.version,
        progress: null,
        busy: false,
      };
  }
}

/** The managed-agent half of the shared vocabulary. */
export function agentUpdateSubject(
  state: AgentUpdateState | null,
  t: Translate,
): UpdateSubject {
  if (!state) {
    return { status: "idle", detail: null, progress: null, busy: false };
  }
  switch (state.status) {
    case "upgrading":
      return {
        status: "upgrading",
        detail: t("update.agents.upgrading", {
          agent: state.agentLabel ?? state.agentId ?? "",
        }),
        progress: null,
        busy: true,
      };
    case "updateAvailable":
      return {
        status: "updateAvailable",
        detail: t("update.agents.available", { count: state.updatesAvailable }),
        progress: null,
        busy: false,
      };
    case "error":
      return {
        status: "error",
        detail: state.error ?? t("update.agents.error"),
        progress: null,
        busy: false,
      };
    case "upToDate":
      return {
        status: "upToDate",
        detail: t("update.agents.upToDate"),
        progress: null,
        busy: false,
      };
    default:
      return { status: "idle", detail: null, progress: null, busy: false };
  }
}

/** Why this build cannot replace itself in place, when it cannot. */
export function appInstallBlockHint(
  state: AppUpdateState | null,
  t: Translate,
): string | null {
  if (!state) return null;
  switch (state.installBlock) {
    case "none":
      return null;
    case "dev":
      return t("update.devBlocked");
    case "platform":
      return t("update.platformBlocked");
    case "unsigned":
      return t("update.unsignedBlocked");
    case "location":
      return t("update.locationBlocked");
    default:
      return null;
  }
}

/**
 * Subscribe to the main process update state.
 *
 * The main process pushes on every transition — including the ones the
 * background scheduler triggers — so both surfaces stay in step with a
 * check that the user did not start.
 */
export function useAppUpdateState(): AppUpdateState | null {
  const [state, setState] = useState<AppUpdateState | null>(null);
  useEffect(() => {
    let live = true;
    void window.backchat
      .updateGetState()
      .then((next) => {
        if (live) setState(next);
      })
      .catch(() => undefined);
    const unsubscribe = window.backchat.onUpdateState((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return state;
}

/**
 * The canonical managed-agent list.
 *
 * The main process pushes a fresh list whenever a background harness
 * upgrade settles, so the combined update status stops reporting a stale
 * "update available" for an agent that is already on the new version.
 */
export function useAgentsList(): AgentInfo[] {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: () => window.backchat.agentsList(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  useEffect(() => {
    const unsubscribe = window.backchat.onAgentsChanged((agents) => {
      queryClient.setQueryData<AgentInfo[]>(AGENTS_QUERY_KEY, agents);
    });
    return unsubscribe;
  }, [queryClient]);
  // The agent list crosses the IPC boundary, so it is checked before it
  // reaches a component that would call `.filter` on it.
  return useMemo(() => (Array.isArray(data) ? data : []), [data]);
}

/**
 * The managed-agent update state, derived from the canonical agent list.
 *
 * The registry list is the source of truth for "a newer version exists";
 * an in-flight upgrade outranks it so the user sees progress instead of a
 * stale availability line.
 */
export function useAgentUpdateState(
  agents: AgentInfo[],
  upgradingAgentId: string | null = null,
): AgentUpdateState {
  return useMemo(
    () => agentUpdateStateFrom(agents, upgradingAgentId),
    [agents, upgradingAgentId],
  );
}
