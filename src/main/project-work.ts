import { ProjectWorkService as Host, type ProjectWorkCommand as HostCommand } from "@openmatter/project-host";
import type { ProjectInfo } from "../shared/projects.js";
import type { ProjectWorkConfig } from "../shared/project-work.js";
import { coordinatorConfig } from "../shared/project-coordinator.js";

export class ProjectWorkService extends Host<ProjectInfo> {
  override config(id: string): ProjectWorkConfig | null {
    const saved = super.config(id);
    return saved ? coordinatorConfig(id, saved) : null;
  }
  override save(config: ProjectWorkConfig): Promise<ProjectWorkConfig> {
    return super.save(coordinatorConfig(config.projectId, config));
  }
  override async submit(input: HostCommand & { agentId?: string; configOverrides?: Record<string, string | boolean> }): Promise<void> {
    let config = this.config(input.projectId);
    const selectedAgent = input.agentId?.trim();
    if (selectedAgent && selectedAgent !== config?.coordinatorAgent && !(await this.view(input.projectId)).facts.sessions.length) {
      config = await this.save({ ...coordinatorConfig(input.projectId, config), coordinatorAgent: selectedAgent });
    }
    if (input.type === "message") {
      const row = this.db.prepare("SELECT data FROM openmatter_project_commands WHERE id=?").get(`${input.projectId}:message:${input.commandId}`) as { data: string } | undefined;
      if (row && JSON.stringify(JSON.parse(row.data).configOverrides ?? {}) !== JSON.stringify(input.configOverrides ?? {})) {
        throw new Error("Message ID was reused for different run options");
      }
    }
    await super.submit(input);
  }
  runConfig(projectId: string, commandId: string): Record<string, string | boolean> {
    const row = this.db.prepare("SELECT data FROM openmatter_project_commands WHERE id=? AND project_id=?").get(`${projectId}:message:${commandId}`, projectId) as { data: string } | undefined;
    return row ? JSON.parse(row.data).configOverrides ?? {} : {};
  }
}
