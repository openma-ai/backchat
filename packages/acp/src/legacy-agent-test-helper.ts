/** Test fixtures retain their method-shaped API; transport and validation use SDK 2. */
import {
  agent,
  type AgentContext,
  type AgentRequestHandlersByMethod,
  type CancelNotification,
  type SessionNotification,
  type RequestPermissionRequest,
  type Stream,
} from "@agentclientprotocol/sdk/unstable";

type Handler<Method extends keyof AgentRequestHandlersByMethod> = (
  params: Parameters<AgentRequestHandlersByMethod[Method]>[0]["params"],
) => ReturnType<AgentRequestHandlersByMethod[Method]>;

export interface TestAgent {
  initialize: Handler<"initialize">;
  newSession: Handler<"session/new">;
  authenticate: Handler<"authenticate">;
  prompt: Handler<"session/prompt">;
  cancel: (params: CancelNotification) => void | Promise<void>;
  loadSession?: Handler<"session/load">;
  resumeSession?: Handler<"session/resume">;
  unstable_forkSession?: Handler<"session/fork">;
  setSessionConfigOption?: Handler<"session/set_config_option">;
  logout?: Handler<"logout">;
}

export class TestAgentConnection {
  constructor(factory: (connection: TestAgentConnection) => TestAgent, stream: Stream) {
    const handlers = factory(this);
    const app = agent()
      .onRequest("initialize", ({ params }) => handlers.initialize(params))
      .onRequest("session/new", ({ params }) => handlers.newSession(params))
      .onRequest("authenticate", ({ params }) => handlers.authenticate(params))
      .onRequest("session/prompt", ({ params }) => handlers.prompt(params))
      .onNotification("session/cancel", ({ params }) => handlers.cancel(params));
    if (handlers.loadSession) app.onRequest("session/load", ({ params }) => handlers.loadSession!(params));
    if (handlers.resumeSession) app.onRequest("session/resume", ({ params }) => handlers.resumeSession!(params));
    if (handlers.unstable_forkSession) app.onRequest("session/fork", ({ params }) => handlers.unstable_forkSession!(params));
    if (handlers.setSessionConfigOption) app.onRequest("session/set_config_option", ({ params }) => handlers.setSessionConfigOption!(params));
    if (handlers.logout) app.onRequest("logout", ({ params }) => handlers.logout!(params));
    this.client = app.connect(stream).client;
  }

  private readonly client: AgentContext;

  sessionUpdate(params: SessionNotification) {
    return this.client.notify("session/update", params);
  }

  createTerminal(...args: Parameters<AgentContext["createTerminal"]>) {
    return this.client.createTerminal(...args);
  }

  requestPermission(params: RequestPermissionRequest) {
    return this.client.request("session/request_permission", params);
  }
}
