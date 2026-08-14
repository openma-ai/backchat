import type {
  ManagedAgentsLabResult,
  ManagedAgentsLabTaskInput,
} from "../shared/managed-agents-lab.js";

export interface ManagedAgentsLabRuntime {
  verifyTunnelsUnsupported(): Promise<{ status: number; type: string; message: string }>;
  createAgent(input: { name: string; model: string; system: string }): Promise<{ agentId: string }>;
  createEnvironment(input: { name: string }): Promise<{ environmentId: string }>;
  createSession(input: {
    agentId: string;
    environmentId: string;
    title?: string;
  }): Promise<{ sessionId: string }>;
  prompt(
    sessionId: string,
    text: string,
    signal?: AbortSignal,
  ): AsyncIterable<Record<string, unknown>>;
  interrupt(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  archiveAgent(agentId: string): Promise<void>;
  archiveEnvironment(environmentId: string): Promise<void>;
}

export interface ManagedAgentsLabEvent {
  kind: "status" | "sdk_event";
  type?: string;
  data?: Record<string, unknown>;
}

export async function runManagedAgentsLab(
  runtime: ManagedAgentsLabRuntime,
  input: ManagedAgentsLabTaskInput,
  emit: (event: ManagedAgentsLabEvent) => void,
  options?: { signal?: AbortSignal },
): Promise<ManagedAgentsLabResult> {
  const suffix = Date.now().toString(36);
  let agentId: string | undefined;
  let environmentId: string | undefined;
  let sessionId: string | undefined;

  try {
    emit({ kind: "status", type: "checking_tunnels" });
    const tunnel = await runtime.verifyTunnelsUnsupported();
    if (tunnel.status !== 501 || tunnel.type !== "not_implemented") {
      throw new Error(`Unexpected MCP Tunnels response: ${tunnel.status} ${tunnel.type}`);
    }

    emit({ kind: "status", type: "creating_resources" });
    ({ agentId } = await runtime.createAgent({
      name: `Backchat Lab ${suffix}`,
      model: input.model,
      system: "You are running inside the Backchat Managed Agents Lab. Be concise and use tools when the task asks for them.",
    }));
    ({ environmentId } = await runtime.createEnvironment({
      name: `Backchat Lab ${suffix}`,
    }));
    ({ sessionId } = await runtime.createSession({
      agentId,
      environmentId,
      title: "Backchat Managed Agents Lab",
    }));

    emit({
      kind: "status",
      type: "streaming",
      data: { agentId, environmentId, sessionId },
    });
    const eventTypes: string[] = [];
    for await (const event of runtime.prompt(sessionId, input.prompt, options?.signal)) {
      const type = typeof event.type === "string" ? event.type : "unknown";
      eventTypes.push(type);
      emit({ kind: "sdk_event", type, data: event });
    }

    return {
      agentId,
      environmentId,
      sessionId,
      eventTypes,
      tunnelStatus: tunnel.type,
    };
  } finally {
    emit({ kind: "status", type: "cleaning_up" });
    if (sessionId) await runtime.dispose(sessionId);
    if (agentId) await runtime.archiveAgent(agentId);
    if (environmentId) await runtime.archiveEnvironment(environmentId);
  }
}
