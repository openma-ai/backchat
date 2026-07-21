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

/** Thin OpenManaged API adapter kept separate from Backchat's local ACP host.
 * It is intentionally not wired to the Cloud composer yet (that remains
 * Coming Soon), but its future UI path will use this same API rather than a
 * second Backchat cloud service. */
export class OpenManagedCloudRuntimeClient {
  #baseUrl: string;
  #apiKey: string;
  #fetch: typeof fetch;

  constructor(options: OpenManagedCloudRuntimeOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async createSession(input: CloudSessionCreateInput): Promise<CloudSessionCreateResult> {
    const body = {
      agent: input.agentId,
      environment_id: input.environmentId,
      title: input.title ?? "",
    };
    const response = await this.#request("/v1/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { id?: unknown };
    if (typeof payload.id !== "string" || !payload.id) {
      throw new Error("OpenManaged session create response did not contain an id");
    }
    return { sessionId: payload.id };
  }

  async *prompt(sessionId: string, text: string): AsyncIterable<Record<string, unknown>> {
    const response = await this.#request(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: { accept: "text/event-stream" },
        body: JSON.stringify({ content: text }),
      },
    );
    if (!response.body) throw new Error("OpenManaged prompt response has no event stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) break;
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = chunk.split(/\r?\n/).find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        try {
          const parsed = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
          yield parsed;
          if (parsed.type === "session.status_idle") return;
        } catch {
          // Ignore malformed provider frames; the persisted event stream is
          // still the source of truth for diagnostics and replay.
        }
      }
    }
  }

  async interrupt(sessionId: string, threadId?: string): Promise<void> {
    await this.#request(`/v1/sessions/${encodeURIComponent(sessionId)}/events`, {
      method: "POST",
      body: JSON.stringify({
        events: [{
          type: "user.interrupt",
          ...(threadId ? { session_thread_id: threadId } : {}),
        }],
      }),
    });
  }

  async dispose(sessionId: string): Promise<void> {
    await this.#request(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        "x-api-key": this.#apiKey,
        "user-agent": "Mozilla/5.0 (compatible; Backchat/0.0.1; +https://openma.dev)",
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`OpenManaged ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    return response;
  }
}
