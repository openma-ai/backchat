import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { ProjectCloudRouter } from "./project-cloud.js";

it("keeps goal mutations on the bound cloud worker without falling back on failure", async () => {
  const db = new DatabaseSync(":memory:");
  const requests: { path?: string; body: unknown; authorization?: string }[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ path: req.url, body: JSON.parse(raw), authorization: req.headers.authorization });
    res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "Worker unavailable" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const local = { db, setGoal: async () => { throw new Error("Unexpected local goal mutation"); } };
  const router = new ProjectCloudRouter(local as never, () => ({ apiKey: "secret" }) as never, () => null, url);
  db.prepare("INSERT INTO backchat_project_cloud VALUES (?, ?)").run("cloud/project", JSON.stringify({ url, scope: { workspaceId: "w" } }));
  try {
    await expect(router.goal({ projectId: "cloud/project", workThreadId: "stable-worker", status: "paused" })).rejects.toThrow("Worker unavailable");
    expect(requests).toEqual([{ path: "/projects/cloud%2Fproject/goal", body: { projectId: "cloud/project", workThreadId: "stable-worker", status: "paused" }, authorization: "Bearer secret" }]);
  } finally {
    db.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("keeps cloud commands on the configured worker and rejects switching an active local project", async () => {
  const db = new DatabaseSync(":memory:");
  let remoteCommands = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/info") {
      res.end(
        JSON.stringify({ openmaUrl: "https://openma.test", workspaceId: "w" }),
      );
      return;
    }
    if (req.headers.authorization !== "Bearer private") {
      res.writeHead(401).end("{}");
      return;
    }
    if (req.url?.endsWith("/commands")) remoteCommands++;
    res.end(
      raw ||
        JSON.stringify({ config: { projectId: "p" }, facts: { turns: [] } }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let pending = 0;
  let localCalls = 0;
  const local = {
    db,
    view: async () => ({ pending, facts: { events: [] } }),
    save: async () => {
      localCalls++;
    },
    submit: async () => {
      localCalls++;
    },
  };
  const connection = () => ({
    baseUrl: "https://openma.test",
    workspaceId: "w",
    userId: "u",
    apiKey: "private",
  });
  const router = new ProjectCloudRouter(
    local as never,
    connection,
    () => ({ id: "p", name: "Project" }) as never,
    url,
  );
  const config = {
    projectId: "p",
    description: "",
    instructions: "",
    context: "",
    resources: [],
    coordinatorAgent: "a",
    workerAgent: "a",
    coordinatorEnvironment: "e",
    workerEnvironment: "e",
    continuity: "per-scope" as const,
    controls: [],
    execution: {
      kind: "cloud" as const,
      baseUrl: "https://openma.test",
      workspaceId: "w",
      userId: "u",
    },
  };
  try {
    pending = 1;
    await expect(router.save(config)).rejects.toThrow(/pending|work/i);
    await expect(router.remove("p")).rejects.toThrow(/pending/);
    pending = 0;
    await router.save(config);
    await router.submit({
      projectId: "p",
      commandId: "business-id",
      type: "message",
      text: "Go",
    });
    expect(remoteCommands).toBe(1);
    expect(localCalls).toBe(0);
    const reopened = new ProjectCloudRouter(
      local as never,
      connection,
      () => ({ id: "p", name: "Project" }) as never,
      url,
    );
    await reopened.view("p");
    await expect(
      reopened.save({ ...config, execution: { kind: "local" } }),
    ).rejects.toThrow(/location|cloud/i);
  } finally {
    db.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
