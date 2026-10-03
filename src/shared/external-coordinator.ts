/** Display record for a coordinator that lives outside Backchat.
 *  One row per client name in a project. It does not configure or replace
 *  the built-in project coordinator. */

export interface ExternalCoordinatorInfo {
  id: string;
  project_id: string;
  name: string;
  created_at: number;
}

export interface ExternalTaskInfo {
  id: string;
  project_id: string;
  coordinator_id: string;
  coordinator_name: string;
  command_id: string;
  type: "message" | "delegate" | "steer" | "cancel" | "complete";
  text: string;
  worker_id: string | null;
  status: "submitted" | "cancelled";
  created_at: number;
}

export interface ExternalTaskNote {
  id: number;
  task_id: string;
  kind: "steer" | "cancel";
  text: string;
  created_at: number;
}

export interface ExternalCoordinatorRemoveResult {
  id: string;
  project_id: string;
  name: string;
  removed: true;
  /** Session ids hard-deleted with the coordinator. Empty when threads were kept. */
  sessions_deleted: string[];
  tasks_deleted: number;
}
