import { DirectAgentRuntime } from "./direct-agent-runtime.js";
import type { OpenmaCatalog } from "../shared/openma.js";
import type { OpenmaConnection } from "./openma-account.js";
import { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime.js";

interface Runtime {
  id: string; machine_id: string; hostname: string; status: string;
  agents: Array<{ id: string }>;
}

export async function loadOpenmaCatalog(options: {
  connection: OpenmaConnection;
  machineId?: string;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
}): Promise<OpenmaCatalog> {
  if (options.connection.provider) return new DirectAgentRuntime({ ...options.connection, provider: options.connection.provider, fetchImpl: options.fetchImpl, onUnauthorized: options.onUnauthorized }).catalog();
  const client = new OpenManagedCloudRuntimeClient({ ...options.connection, fetchImpl: options.fetchImpl, onUnauthorized: options.onUnauthorized });
  const sdk = client.sdk;
  const [runtimeList, agents, environments] = await Promise.all([
    options.connection.canManageRuntimes === false ? Promise.resolve({ runtimes: [] as Runtime[] }) : client.request(() => sdk.oma.request<{ runtimes: Runtime[] }>({ method: "get", path: "/v1/oma/runtimes" })),
    client.request(async () => { const result = []; for await (const agent of sdk.beta.agents.list()) result.push(agent); return result; }),
    client.request(async () => { const result = []; for await (const env of sdk.beta.environments.list()) result.push(env); return result; }),
  ]);
  return {
    runners: (runtimeList.runtimes ?? []).map((runtime) => ({
      id: runtime.id, machineId: runtime.machine_id, name: runtime.hostname,
      status: runtime.status === "online" ? "online" : "offline",
      isLocal: !!options.machineId && runtime.machine_id === options.machineId,
      agents: (runtime.agents ?? []).map((harness) => ({
        id: harness.id,
        bindings: agents.filter((agent) => agent._oma?.runtime_binding?.runtime_id === runtime.id
          && agent._oma.runtime_binding.acp_agent_id === harness.id).map((agent) => ({ id: agent.id, name: agent.name })),
      })),
    })),
    cloudAgents: agents.filter((agent) => !agent._oma?.runtime_binding).map((agent) => ({ id: agent.id, name: agent.name })),
    environments: environments.filter((env) => ["cloud", "self_hosted"].includes(env.config?.type) && !env.archived_at).map((env) => ({
      id: env.id, name: env.name ?? env.id, type: env.config.type as "cloud" | "self_hosted",
      runtimeId: env.config.type === "self_hosted" && typeof env.metadata?.["backchat.runtime_id"] === "string" ? env.metadata["backchat.runtime_id"] : null,
      ...(typeof env.metadata?.["backchat.project_name"] === "string" ? { projectName: env.metadata["backchat.project_name"] } : {}),
    })),
  };
}
