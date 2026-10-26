import type { SessionRow } from "./session-types";

export type SidebarActivityStatus = "idle" | "unread" | "running" | "error" | "approval";

/** Presentation only: the session store remains authoritative for turn lifetime (I1/I3). */
export function getSessionSidebarStatus(
  row: Pick<SessionRow, "status" | "pendingAsks" | "lastError" | "authRequired" | "unread">,
  active = false,
): SidebarActivityStatus {
  if (row.pendingAsks?.length) return "approval";
  if (row.authRequired || row.status === "errored") return "error";
  if (row.status === "running" || row.status === "starting") return "running";
  if (row.lastError) return "error";
  return row.unread && !active ? "unread" : "idle";
}

const priority: Record<SidebarActivityStatus, number> = { idle: 0, unread: 1, running: 2, error: 3, approval: 4 };

export function aggregateSidebarStatus(statuses: readonly SidebarActivityStatus[]): SidebarActivityStatus {
  return statuses.reduce<SidebarActivityStatus>((result, status) => priority[status] > priority[result] ? status : result, "idle");
}
