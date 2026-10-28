import type { ProjectWorkConfig } from "./project-work.js";

/** Coordinator capabilities are product-owned, never opt-in project settings. */
export const coordinatorControls = ["delegate", "steer", "cancel", "complete"] as const;

export function coordinatorConfig(projectId: string, config?: ProjectWorkConfig | null): ProjectWorkConfig {
  const base: ProjectWorkConfig = {
    projectId, description: "", instructions: "", context: "", resources: [],
    coordinatorAgent: "", workerAgent: "", continuity: "per-scope", controls: [],
    ...config,
  };
  return { ...base, workerAgent: base.workerAgent || base.coordinatorAgent, controls: [...coordinatorControls] };
}
