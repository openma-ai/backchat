import type {
  ExternalCoordinatorInfo,
  ExternalTaskInfo,
} from "@shared/external-coordinator";
import type { SessionRow } from "./session-types";

export interface ExternalCoordinatorNode {
  coordinator: ExternalCoordinatorInfo;
  sessions: SessionRow[];
  tasks: ExternalTaskInfo[];
}

export function externalCoordinatorNodes(
  projectId: string | undefined,
  sessions: readonly SessionRow[],
  coordinators: readonly ExternalCoordinatorInfo[],
  tasks: readonly ExternalTaskInfo[],
): ExternalCoordinatorNode[] {
  if (!projectId) return [];
  return coordinators
    .filter((coordinator) => coordinator.project_id === projectId)
    .map((coordinator) => ({
      coordinator,
      sessions: sessions.filter((session) =>
        session.projectId === projectId && session.externalClient === coordinator.name
      ),
      tasks: tasks.filter((task) => task.coordinator_id === coordinator.id),
    }));
}

/** Sessions that should leave the ordinary project/workspace lists and render
 *  under their external coordinator row. Removing the coordinator drops the
 *  match, so those sessions reappear in the project list. */
export function externalCoordinatorSessionIds(
  sessions: readonly SessionRow[],
  coordinators: readonly ExternalCoordinatorInfo[],
): Set<string> {
  const keys = new Set(coordinators.map((coordinator) => `${coordinator.project_id}\0${coordinator.name}`));
  return new Set(
    sessions
      .filter((session) =>
        !!session.projectId
        && !!session.externalClient
        && keys.has(`${session.projectId}\0${session.externalClient}`)
      )
      .map((session) => session.id),
  );
}
