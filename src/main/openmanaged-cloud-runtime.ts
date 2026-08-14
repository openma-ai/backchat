import Anthropic from "@anthropic-ai/sdk";
import type { ManagedAgentsLabModelOption } from "../shared/managed-agents-lab.js";

export interface OpenManagedCloudRuntimeOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface CloudSessionCreateInput {
  agentId: string;
  environmentId: string;
  title?: string;
}

export interface CloudSessionCreateResult {
  sessionId: string;
}

export interface TunnelUnsupportedResult {
  status: 501;
  type: "not_implemented";
  message: string;
}

/** Official Claude Managed Agents SDK adapter for Backchat's cloud surface.
 * The SDK owns request paths, beta headers, error decoding, pagination, and
 * SSE parsing; Backchat only maps those typed operations into its UI model. */
export class OpenManagedCloudRuntimeClient {
  #client: Anthropic;

  constructor(options: OpenManagedCloudRuntimeOptions) {
    this.#client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl.replace(/\/$/, ""),
      ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
      maxRetries: 0,
    });
  }

  /** List the tenant's configured model handles through the same control
   * plane endpoint and credential used for Managed Agents operations. */
  async listModels(): Promise<ManagedAgentsLabModelOption[]> {
    const models: ManagedAgentsLabModelOption[] = [];
    for await (const model of this.#client.beta.models.list({ limit: 100 })) {
      models.push({
        id: model.id,
        displayName: model.display_name || model.id,
      });
    }
    return models;
  }

  async verifyTunnelsUnsupported(): Promise<TunnelUnsupportedResult> {
    try {
      const tunnel = await this.#client.beta.tunnels.create({
        display_name: "Backchat capability probe",
      });
      await this.#client.beta.tunnels.archive(tunnel.id);
      throw new Error("MCP Tunnels unexpectedly returned a tunnel instead of 501");
    } catch (error) {
      const apiError = error as {
        status?: number;
        error?: {
          type?: string;
          error?: { type?: string; message?: string };
        };
      };
      const detail = apiError.error?.error;
      if (
        apiError.status === 501 &&
        detail?.type === "not_implemented" &&
        typeof detail.message === "string"
      ) {
        return {
          status: 501,
          type: "not_implemented",
          message: detail.message,
        };
      }
      throw error;
    }
  }

  async createAgent(input: {
    name: string;
    model: string;
    system: string;
  }): Promise<{ agentId: string }> {
    const agent = await this.#client.beta.agents.create(input);
    return { agentId: agent.id };
  }

  async archiveAgent(agentId: string): Promise<void> {
    await this.#client.beta.agents.archive(agentId);
  }

  async createEnvironment(input: { name: string }): Promise<{ environmentId: string }> {
    const environment = await this.#client.beta.environments.create({
      name: input.name,
      config: { type: "cloud" },
    });
    return { environmentId: environment.id };
  }

  async archiveEnvironment(environmentId: string): Promise<void> {
    await this.#client.beta.environments.archive(environmentId);
  }

  async createSession(input: CloudSessionCreateInput): Promise<CloudSessionCreateResult> {
    const session = await this.#client.beta.sessions.create({
      agent: input.agentId,
      environment_id: input.environmentId,
      title: input.title ?? "",
    });
    return { sessionId: session.id };
  }

  async *prompt(
    sessionId: string,
    text: string,
    signal?: AbortSignal,
  ): AsyncIterable<Record<string, unknown>> {
    const stream = await this.#client.beta.sessions.events.stream(sessionId, {
      event_deltas: ["agent.message"],
    }, { signal });
    await this.#client.beta.sessions.events.send(sessionId, {
      events: [{
        type: "user.message",
        content: [{ type: "text", text }],
      }],
    }, { signal });

    for await (const event of stream) {
      const frame = event as unknown as Record<string, unknown>;
      yield frame;
      if (frame.type === "session.status_idle") return;
    }
  }

  async interrupt(sessionId: string, threadId?: string): Promise<void> {
    await this.#client.beta.sessions.events.send(sessionId, {
      events: [{
        type: "user.interrupt",
        ...(threadId ? { session_thread_id: threadId } : {}),
      }],
    });
  }

  async dispose(sessionId: string): Promise<void> {
    await this.#client.beta.sessions.delete(sessionId);
  }
}
