import { createServer, type Server } from "node:http";

type MockOptions = {
  cloudEnvironmentCount: number;
  cloudAgentCount?: number;
};

/** Minimal OpenMA HTTP mock for signed-in catalog / host picker seeds. */
export async function startOpenmaCatalogMock(
  options: MockOptions,
): Promise<{ server: Server; baseUrl: string; close: () => Promise<void> }> {
  const tenantId = "demo";
  const cloudAgentCount = options.cloudAgentCount ?? 1;
  const agents = Array.from({ length: cloudAgentCount }, (_, index) => ({
    id: `agent-${index}`,
    name: `Helper ${index + 1}`,
  }));
  const environments = Array.from({ length: options.cloudEnvironmentCount }, (_, index) => ({
    id: `env-${index}`,
    name: `Cloud project ${String(index + 1).padStart(2, "0")}`,
    type: "environment",
    config: { type: "cloud" },
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    description: null,
    metadata: {},
  }));

  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const reply = (value: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (url.pathname === "/cli/login") {
      const callback = new URL(url.searchParams.get("callback")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("user", "user");
      callback.searchParams.set(
        "tokens",
        Buffer.from(
          JSON.stringify([
            {
              tenant_id: tenantId,
              tenant_name: "Demo",
              role: "owner",
              token: "demo-key",
              key_id: "demo-key-id",
            },
          ]),
        ).toString("base64"),
      );
      res.writeHead(302, { location: callback.href }).end();
      return;
    }
    if (url.pathname === "/v1/oma/me") {
      return reply({
        user: { id: "user", email: "picker@example.com", name: "Picker" },
        tenant: { id: tenantId },
        tenants: [{ id: tenantId, name: "Demo", role: "owner" }],
      });
    }
    if (url.pathname === "/v1/environments") {
      return reply({ data: environments, has_more: false });
    }
    if (url.pathname === "/v1/agents") {
      return reply({ data: agents, has_more: false });
    }
    if (url.pathname === "/v1/oma/runtimes") {
      return reply({ runtimes: [] });
    }
    if (url.pathname.endsWith("/events/stream")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": ready\n\n");
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    server,
    baseUrl,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
