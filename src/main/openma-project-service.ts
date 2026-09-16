import type { OpenmaProjectBinding, OpenmaRunnerState, OpenmaScope } from "../shared/openma.js";
import type { ProjectInfo } from "../shared/projects.js";
import type { OpenmaAccount } from "./openma-account.js";
import type { OpenmaProjectEnvironments } from "./openma-project-environments.js";
import { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime.js";
import { loadOpenmaCatalog } from "./openma-catalog.js";

export class OpenmaProjectService {
  constructor(private options: {
    account: OpenmaAccount;
    bindings: OpenmaProjectEnvironments;
    runner: () => OpenmaRunnerState;
    project: (id: string) => ProjectInfo | null;
    fetchImpl?: typeof fetch;
  }) {}

  #context(scope?: OpenmaScope) {
    const connection = this.options.account.connection(scope);
    return {
      connection,
      client: new OpenManagedCloudRuntimeClient({ ...connection, fetchImpl: this.options.fetchImpl, onUnauthorized: () => this.options.account.invalidate(connection) }),
      check: () => {
        this.options.account.assertConnection(connection);
        const current = this.options.account.connection(scope);
        if (current.baseUrl !== connection.baseUrl || current.userId !== connection.userId || current.workspaceId !== connection.workspaceId) throw new Error("OpenMA workspace changed. Open project settings again.");
      },
    };
  }

  async catalog(scope?: OpenmaScope) {
    const { connection, check } = this.#context(scope);
    const result = await loadOpenmaCatalog({ connection, machineId: this.options.runner().machineId ?? undefined, fetchImpl: this.options.fetchImpl, onUnauthorized: () => this.options.account.invalidate(connection) });
    check(); return result;
  }

  list() { return this.options.bindings.list(this.options.account.connection()); }

  async link(binding: OpenmaProjectBinding): Promise<void> {
    this.options.bindings.validate(binding);
    const { connection, client, check } = this.#context();
    const env = await client.request(() => client.sdk.beta.environments.retrieve(binding.environmentId));
    check();
    if (env.archived_at) throw new Error("Choose an active environment");
    if (binding.runtimeId === null) {
      if (env.config.type !== "cloud") throw new Error("Choose a cloud environment or connect this machine as a runner");
    } else {
      if (env.config.type !== "self_hosted") throw new Error("A local project requires a self-hosted environment");
      if (binding.runtimeId !== this.options.runner().runtimeId) throw new Error("Link local directories on the machine that will run the project");
      if (this.options.runner().hosting !== "backchat") throw new Error("Configure this project's directory in the external daemon. Backchat does not manage its execution environment.");
      const assigned = env.metadata?.["backchat.runtime_id"];
      if (assigned && assigned !== binding.runtimeId) throw new Error("This environment belongs to a project on another runner. Choose a separate environment.");
      const project = this.options.project(binding.projectId);
      if (!project) throw new Error("The project is no longer available");
      await client.request(() => client.sdk.beta.environments.update(env.id, { metadata: {
        ...env.metadata, "backchat.runtime_id": binding.runtimeId,
        "backchat.project_id": binding.projectId, "backchat.project_name": project.name,
      } }));
      check();
    }
    this.options.bindings.link(connection, binding);
  }

  async unlink(binding: OpenmaProjectBinding): Promise<void> {
    const { connection, client, check } = this.#context();
    if (binding.runtimeId !== null && binding.runtimeId !== this.options.runner().runtimeId) throw new Error("Unlink local directories on their runner");
    const current = this.list().find((saved) => saved.environmentId === binding.environmentId && saved.runtimeId === binding.runtimeId);
    if (current && current.projectId !== binding.projectId) throw new Error("The project environment changed. Refresh before unlinking it.");
    // Local consent ends immediately, even if the server is unreachable.
    this.options.bindings.unlink(connection, binding.environmentId, binding.runtimeId);
    if (binding.runtimeId === null) return;
    const env = await client.request(() => client.sdk.beta.environments.retrieve(binding.environmentId));
    check();
    if (env.metadata?.["backchat.runtime_id"] === binding.runtimeId && env.metadata?.["backchat.project_id"] === binding.projectId) {
      const metadata = { ...env.metadata };
      delete metadata["backchat.runtime_id"]; delete metadata["backchat.project_id"]; delete metadata["backchat.project_name"];
      await client.request(() => client.sdk.beta.environments.update(env.id, { metadata }));
    }
  }
}
