import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import type { SessionRuntimeStatus } from "@shared/session-events.js";

import { Button } from "@/components/ui/button";
import { TASK_LIFECYCLE_TOASTER_ID } from "@/components/ui/sonner";
import { useI18n } from "@/lib/i18n";

export function SessionRuntimeUpdateControl({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["session-runtime", sessionId] as const,
    [sessionId],
  );
  const updateToastId = `session-runtime-update:${sessionId}`;
  const successToastId = `${updateToastId}:success`;
  const { data: status } = useQuery<SessionRuntimeStatus | null>({
    queryKey,
    queryFn: () => window.backchat.sessionRuntimeStatus({
      session_id: sessionId,
    }),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  const finishRestart = useCallback(() => {
    const current = queryClient.getQueryData<SessionRuntimeStatus | null>(
      queryKey,
    );
    const version = current?.installed_version;
    queryClient.setQueryData(
      queryKey,
      current
        ? {
            ...current,
            running_version: current.installed_version,
            restart_required: false,
            restart_pending: false,
            busy: false,
          }
        : current,
    );
    toast.dismiss(updateToastId);
    toast.success(t("acpUpdate.restarted"), {
      id: successToastId,
      description: version
        ? t("acpUpdate.restartedVersion", { version })
        : t("acpUpdate.restartedDescription"),
      position: "top-right",
      duration: 2_400,
      closeButton: true,
      toasterId: TASK_LIFECYCLE_TOASTER_ID,
    });
    void queryClient.invalidateQueries({ queryKey });
  }, [
    queryClient,
    queryKey,
    successToastId,
    t,
    updateToastId,
  ]);

  const { mutate: requestRestart } = useMutation({
    mutationFn: (mode: "now" | "after-turn") =>
      window.backchat.sessionRestart({
        session_id: sessionId,
        mode,
      }),
    onMutate: () => {
      toast.loading(t("acpUpdate.restarting"), {
        id: updateToastId,
        description: t("acpUpdate.restartingDescription"),
        position: "top-right",
        duration: Infinity,
        closeButton: false,
        toasterId: TASK_LIFECYCLE_TOASTER_ID,
      });
    },
    onSuccess: (result) => {
      if (result.status === "pending") {
        queryClient.setQueryData<SessionRuntimeStatus | null>(
          queryKey,
          (current) => current
            ? { ...current, restart_pending: true }
            : current,
        );
        toast.info(t("acpUpdate.queued"), {
          id: updateToastId,
          description: t("acpUpdate.queuedDescription"),
          position: "top-right",
          duration: Infinity,
          closeButton: true,
          toasterId: TASK_LIFECYCLE_TOASTER_ID,
        });
      } else {
        finishRestart();
      }
    },
    onError: (error) => {
      toast.error(t("acpUpdate.failed"), {
        id: updateToastId,
        description: error instanceof Error
          ? error.message
          : t("acpUpdate.failedDescription"),
        position: "top-right",
        duration: Infinity,
        closeButton: true,
        toasterId: TASK_LIFECYCLE_TOASTER_ID,
      });
    },
  });

  useEffect(() => window.backchat.onSessionEvent((event) => {
    if (event.session_id !== sessionId) return;
    if (event.type === "session.restart_pending") {
      queryClient.setQueryData<SessionRuntimeStatus | null>(
        queryKey,
        (current) => current
          ? { ...current, restart_pending: true }
          : current,
      );
      toast.info(t("acpUpdate.queued"), {
        id: updateToastId,
        description: t("acpUpdate.queuedDescription"),
        position: "top-right",
        duration: Infinity,
        closeButton: true,
        toasterId: TASK_LIFECYCLE_TOASTER_ID,
      });
    } else if (event.type === "session.restarted") {
      finishRestart();
    } else if (event.type === "session.ready") {
      void queryClient.invalidateQueries({ queryKey });
    }
  }), [
    finishRestart,
    queryClient,
    queryKey,
    sessionId,
    t,
    updateToastId,
  ]);

  const versionText =
    status?.running_version && status.installed_version
      ? `${status.running_version} → ${status.installed_version}`
      : null;
  const showUpdateToast = useCallback(() => {
    if (!status) return;
    if (status.restart_pending) {
      toast.info(t("acpUpdate.queued"), {
        id: updateToastId,
        description: t("acpUpdate.queuedDescription"),
        position: "top-right",
        duration: Infinity,
        closeButton: true,
        toasterId: TASK_LIFECYCLE_TOASTER_ID,
      });
      return;
    }
    if (!status.restart_required) return;
    toast.warning(t("acpUpdate.installed"), {
      id: updateToastId,
      description: versionText
        ? t("acpUpdate.installedVersion", { version: versionText })
        : t("acpUpdate.installedDescription"),
      position: "top-right",
      duration: Infinity,
      closeButton: true,
      toasterId: TASK_LIFECYCLE_TOASTER_ID,
      action: {
        label: status.busy
          ? t("acpUpdate.afterTurn")
          : t("acpUpdate.restart"),
        onClick: () => requestRestart(
          status.busy ? "after-turn" : "now",
        ),
      },
    });
  }, [requestRestart, status, t, updateToastId, versionText]);

  useEffect(() => {
    if (status?.restart_required || status?.restart_pending) {
      showUpdateToast();
    } else {
      toast.dismiss(updateToastId);
    }
  }, [
    showUpdateToast,
    status?.restart_pending,
    status?.restart_required,
    updateToastId,
  ]);

  if (!status || (!status.restart_required && !status.restart_pending)) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={showUpdateToast}
      aria-label={status.restart_pending
        ? t("acpUpdate.queued")
        : t("acpUpdate.controlLabel")}
      title={status.restart_pending
        ? t("acpUpdate.queued")
        : t("acpUpdate.controlLabel")}
      className="h-7 gap-1.5 px-2 text-xs text-warning hover:bg-warning-subtle/45 hover:text-warning"
    >
      <RefreshCwIcon className="size-3.5" />
      <span>
        {status.restart_pending
          ? t("acpUpdate.queuedShort")
          : t("acpUpdate.restart")}
      </span>
    </Button>
  );
}
