import { snapshotProjectAttachments } from "./project-attachments.js";
import type { ProjectWorkService } from "./project-work.js";
import type { OpenmaConnection } from "./openma-account.js";
import type { OpenmaScope } from "../shared/openma.js";
import type { ProjectInfo } from "../shared/projects.js";
import type {
  ProjectWorkConfig,
  ProjectWorkCommand,
  ProjectWorkGoalInput,
  ProjectWorkView,
} from "../shared/project-work.js";
type Binding = { url: string; scope: OpenmaScope; config?: ProjectWorkConfig };
/** Routing belongs to Backchat. A saved cloud project never falls back to local. */
export class ProjectCloudRouter {
  constructor(
    readonly local: ProjectWorkService,
    readonly connection: (scope?: OpenmaScope) => OpenmaConnection,
    readonly project: (id: string) => ProjectInfo | null,
    readonly workerUrl: string | undefined,
  ) {
    local.db.exec(
      "CREATE TABLE IF NOT EXISTS backchat_project_cloud(project_id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
  }
  binding(id: string): Binding | null {
    const row = this.local.db
      .prepare("SELECT data FROM backchat_project_cloud WHERE project_id=?")
      .get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }
  async request<T>(
    binding: Binding,
    path: string,
    method = "GET",
    input?: unknown,
  ) {
    const connection = this.connection(binding.scope);
    if (connection.provider)
      throw new Error("Projects worker requires an OpenMA connection");
    const response = await fetch(`${binding.url}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${connection.apiKey}`,
        "x-active-tenant": binding.scope.workspaceId,
        "content-type": "application/json",
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        body.error ?? `Projects worker returned ${response.status}`,
      );
    }
    return response.json() as Promise<T>;
  }
  async view(id: string): Promise<ProjectWorkView> {
    const binding = this.binding(id);
    if (!binding) return this.local.view(id);
    try {
      return await this.request<ProjectWorkView>(
        binding,
        `/projects/${encodeURIComponent(id)}`,
      );
    } catch (error) {
      const fallback = await this.local.view(id);
      return {
        ...fallback,
        config: binding.config ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  async save(config: ProjectWorkConfig): Promise<ProjectWorkConfig> {
    const previous = this.binding(config.projectId);
    if (config.execution?.kind !== "cloud") {
      if (previous)
        throw new Error(
          "A cloud project cannot change execution location. Create a separate project.",
        );
      return this.local.save(config);
    }
    const { kind: _, ...scope } = config.execution;
    const connection = this.connection(scope);
    if (connection.provider) throw new Error("Choose an OpenMA workspace");
    let binding = previous;
    if (previous && JSON.stringify(previous.scope) !== JSON.stringify(scope))
      throw new Error("A cloud project cannot change its OpenMA workspace");
    if (!binding) {
      const local = await this.local.view(config.projectId);
      if (local.pending || local.facts.events.length)
        throw new Error(
          "This project already has local work. Create a separate cloud project.",
        );
      if (!this.workerUrl)
        throw new Error(
          "Set BACKCHAT_PROJECT_WORKER_URL to your deployed Projects worker",
        );
      const url = new URL(this.workerUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error("Invalid Projects worker URL");
      if (
        url.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
        throw new Error("Remote Projects workers require HTTPS");
      binding = { url: url.href.replace(/\/$/, ""), scope };
      const infoResponse = await fetch(`${binding.url}/info`, {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!infoResponse.ok) throw new Error("Projects worker is unavailable");
      const info = (await infoResponse.json()) as {
        workspaceId?: string;
        openmaUrl?: string;
      };
      if (
        info.workspaceId !== scope.workspaceId ||
        info.openmaUrl?.replace(/\/$/, "") !== scope.baseUrl.replace(/\/$/, "")
      )
        throw new Error(
          "Projects worker belongs to a different OpenMA workspace",
        );
    }
    const project = this.project(config.projectId);
    if (!project) throw new Error("Unknown project");
    // Persist routing before the remote PUT: an uncertain network result must not
    // make the same business project executable by the local scheduler.
    this.local.db
      .prepare(
        "INSERT INTO backchat_project_cloud VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data",
      )
      .run(config.projectId, JSON.stringify({ ...binding, config }));
    return this.request<ProjectWorkConfig>(
      binding,
      `/projects/${encodeURIComponent(config.projectId)}`,
      "PUT",
      { project, config },
    );
  }
  async remove(id: string): Promise<void> {
    const binding = this.binding(id);
    if (binding) {
      await this.request(
        binding,
        `/projects/${encodeURIComponent(id)}`,
        "DELETE",
      );
      this.local.db
        .prepare("DELETE FROM backchat_project_cloud WHERE project_id=?")
        .run(id);
    } else if ((await this.local.view(id)).pending)
      throw new Error(
        "Wait for pending project work before deleting the project",
      );
  }
  async submit(input: ProjectWorkCommand): Promise<void> {
    const command = {
      ...input,
      attachments: await snapshotProjectAttachments(input.attachments),
    };
    const binding = this.binding(input.projectId);
    if (binding)
      await this.request(
        binding,
        `/projects/${encodeURIComponent(input.projectId)}/commands`,
        "POST",
        command,
      );
    else await this.local.submit(command);
  }

  async goal(input: ProjectWorkGoalInput) {
    const binding = this.binding(input.projectId);
    if (binding) {
      const result = await this.request<{ goal: import("../shared/project-work.js").ProjectWorkOutcome | null }>(
        binding,
        `/projects/${encodeURIComponent(input.projectId)}/goal`,
        "POST",
        input,
      );
      return result.goal;
    }
    return this.local.setGoal(input);
  }
}
