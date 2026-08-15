import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import {
  formatListedTaskNames,
  liveSchedulesForSessions,
  scheduleArchiveCopyKind,
  SCHEDULES_QUERY_KEY,
} from "@/lib/scheduled-task-presentation";
import { sessionStore } from "@/lib/session-store";
import type { ScheduleInfo } from "@shared/schedules.js";

export function useArchiveSessions() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{
    sessionIds: string[];
    taskNames: string[];
    after?: () => void;
  } | null>(null);

  const commit = (sessionIds: string[], after?: () => void) => {
    for (const sessionId of sessionIds) sessionStore.archive(sessionId);
    void queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    after?.();
    setPending(null);
  };

  const requestArchive = async (sessionIds: string[], after?: () => void) => {
    if (sessionIds.length === 0) return;
    let schedules: ScheduleInfo[] =
      queryClient.getQueryData(SCHEDULES_QUERY_KEY) ?? [];
    try {
      schedules = await queryClient.fetchQuery({
        queryKey: SCHEDULES_QUERY_KEY,
        queryFn: () => window.backchat.schedulesList(),
      });
    } catch {
      /* use cached list when the probe fails */
    }
    const live = liveSchedulesForSessions(schedules, sessionIds);
    if (live.length === 0) {
      commit(sessionIds, after);
      return;
    }
    setPending({
      sessionIds,
      taskNames: live.map((schedule) => schedule.name),
      after,
    });
  };

  return {
    pending,
    requestArchive,
    confirmArchive: () => {
      if (!pending) return;
      commit(pending.sessionIds, pending.after);
    },
    cancelArchive: () => setPending(null),
  };
}

export function ArchiveScheduledChatDialog({
  open,
  taskNames,
  sessionCount,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  taskNames: readonly string[];
  sessionCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { locale, t } = useI18n();
  const kind = scheduleArchiveCopyKind(sessionCount, taskNames.length);
  const name = formatListedTaskNames(taskNames, locale);
  const body = t(
    kind === "chats"
      ? "scheduled.archiveBodyChats"
      : kind === "tasks"
        ? "scheduled.archiveBodyPlural"
        : "scheduled.archiveBody",
    { name },
  );
  const nameIndex = name ? body.indexOf(name) : -1;
  const title = kind === "chats"
    ? t("scheduled.archiveTitleChats")
    : kind === "tasks"
      ? t("scheduled.archiveTitlePlural")
      : t("scheduled.archiveTitle");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="text-fg">
            {nameIndex >= 0 ? (
              <>
                {body.slice(0, nameIndex)}
                <strong>{name}</strong>
                {body.slice(nameIndex + name.length)}
              </>
            ) : body}
          </p>
          <p className="text-fg-muted">
            {t(kind === "task" ? "scheduled.archiveHint" : "scheduled.archiveHintPlural")}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {t("scheduled.archiveConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
