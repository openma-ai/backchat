import type { ProjectInfo } from "./projects.js";
import type { OpenmaScope } from "./openma.js";
import type {
  ProjectWorkConfig as HostConfig,
  ProjectWorkView as HostView,
} from "@openmatter/project-host";
import type { ThreadGoal } from "@openmatter/project-host";
export type { ThreadGoal } from "@openmatter/project-host";
import type { ProjectWorkCommand as HostCommand } from "@openmatter/project-host";
import type { PromptAttachment } from "./session-events.js";
export type ProjectWorkCommand = Omit<HostCommand, "attachments"> & {
  attachments?: PromptAttachment[];
};
/** Host-controlled outcome state for one stable WorkThread. */
export interface ProjectWorkGoalInput {
  projectId: string;
  workThreadId: string;
  objective?: string;
  status?: "active" | "paused";
  tokenBudget?: number | null;
  clear?: boolean;
}
export type ProjectWorkOutcome = ThreadGoal;
export interface ProjectWorkConfig extends HostConfig {
  execution?: { kind: "local" } | ({ kind: "cloud" } & OpenmaScope);
}
export type ProjectWorkView = Omit<HostView<ProjectInfo>, "config"> & {
  config: ProjectWorkConfig | null;
};
