import type { OpenmaCatalog, OpenmaExecutionTarget, OpenmaScope } from "@shared/openma";

export function openmaTargets(scope: OpenmaScope, catalog: OpenmaCatalog): Array<{ target: OpenmaExecutionTarget; offline: boolean }> {
  return catalog.environments.flatMap<{ target: OpenmaExecutionTarget; offline: boolean }>((environment) => {
    if (environment.type === "cloud") return catalog.cloudAgents.map((agent) => ({ offline: false, target: { ...scope, kind: "cloud" as const, agentId: agent.id, agentName: agent.name, environmentId: environment.id, environmentName: environment.name, runtimeId: null, runtimeName: "Cloud" } }));
    const runner = catalog.runners.find((r) => r.id === environment.runtimeId);
    if (!runner) return [];
    return runner.agents.flatMap((a) => a.bindings).map((agent) => ({ offline: runner.status !== "online", target: { ...scope, kind: "runner" as const, agentId: agent.id, agentName: agent.name, environmentId: environment.id, environmentName: environment.name, runtimeId: runner.id, runtimeName: runner.name } }));
  });
}
