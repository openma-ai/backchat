import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { makeMockAgentDriver } from "@openmatter/agent-mock";
import { ProjectWorkService } from "./project-work.js";
const paths: string[] = [];
const services: ProjectWorkService[] = [];
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true });
});
const project = {
  id: "business-project",
  name: "Research",
  source_folders: [],
  primary_folder: "",
  created_at: 1,
  updated_at: 1,
};
const setup = (path?: string) => {
  if (!path) {
    path = mkdtempSync(join(tmpdir(), "backchat-project-"));
    paths.push(path);
  }
  const service = new ProjectWorkService({
    directory: path,
    getProject: (id) => (id === project.id ? project : null),
    driver: (id) =>
      makeMockAgentDriver({
        id,
        output: id === "worker" ? "worker result" : "reviewed",
      }).driver,
  });
  services.push(service);
  return { service, path };
};
it("keeps built-in submit dependent on coordinator setup", async () => {
  const { service } = setup();
  await expect(service.submit({
    projectId: project.id,
    commandId: "unconfigured",
    type: "message",
    text: "Hello",
  })).rejects.toThrow(/Configure this project first/);
  await service.save({
    projectId: project.id,
    description: "",
    instructions: "",
    context: "",
    resources: [],
    coordinatorAgent: "coordinator",
    workerAgent: "worker",
    continuity: "per-scope",
    controls: ["delegate", "steer", "cancel", "complete"],
  });
  await service.submit({
    projectId: project.id,
    commandId: "configured",
    type: "message",
    text: "Hello from the built-in coordinator",
  });
  await service.drain();
  const view = await service.view(project.id);
  expect(view.config?.coordinatorAgent).toBe("coordinator");
  expect(view.facts.sessions.some((session) => session.agentId === "coordinator")).toBe(true);
});
it("persists project context and routes independent workers back to the coordinator across reopen", async () => {
  const { service, path } = setup();
  await service.save({
    projectId: project.id,
    description: "Research",
    instructions: "Cite sources",
    context: "Background",
    resources: [{ id: "doc-1", name: "Brief", text: "Read me" }],
    coordinatorAgent: "coordinator",
    workerAgent: "worker",
    continuity: "per-scope",
    controls: ["delegate", "steer", "cancel", "complete"],
  });
  await service.submit({
    projectId: project.id,
    commandId: "msg-1",
    type: "message",
    text: "Start",
  });
  await service.drain();
  await service.submit({
    projectId: project.id,
    commandId: "job-1",
    type: "delegate",
    workerId: "business-task-123",
    text: "Find sources",
  });
  await service.drain();
  const before = await service.view(project.id);
  expect(before.facts.sessions.map((s) => s.agentId).sort()).toEqual([
    "coordinator",
    "worker",
  ]);
  expect(
    before.facts.contexts.some((c) =>
      c.items.some(
        (i) =>
          i.kind === "project-resource" &&
          JSON.stringify(i.value).includes("Read me"),
      ),
    ),
  ).toBe(true);
  expect(
    before.facts.contexts.some((c) =>
      c.items.some((i) => i.kind === "coordinator-worker-result"),
    ),
  ).toBe(true);
  await service.close();
  const reopened = setup(path).service;
  expect((await reopened.view(project.id)).config?.instructions).toBe(
    "Cite sources",
  );
  await reopened.submit({
    projectId: project.id,
    commandId: "job-1",
    type: "delegate",
    workerId: "business-task-123",
    text: "Find sources",
  });
  await reopened.drain();
  expect((await reopened.view(project.id)).facts.turns).toHaveLength(
    before.facts.turns.length,
  );
  await expect(
    reopened.submit({
      projectId: "unknown",
      commandId: "bad",
      type: "message",
      text: "secret",
    }),
  ).rejects.toThrow(/project/i);
});
it("isolates per-run sessions and validates configuration before persisting", async () => {
  const { service } = setup();
  const config = {
    projectId: project.id,
    description: "",
    instructions: "",
    context: "",
    resources: [],
    coordinatorAgent: "coordinator",
    workerAgent: "worker",
    continuity: "per-run" as const,
    controls: ["delegate" as const],
  };
  await expect(
    service.save({ ...config, coordinatorAgent: "" }),
  ).rejects.toThrow(/agent/i);
  await service.save(config);
  for (const id of ["one", "two"]) {
    await service.submit({
      projectId: project.id,
      commandId: id,
      runId: id,
      type: "message",
      text: "Hello",
    });
    await service.drain();
  }
  expect((await service.view(project.id)).facts.sessions).toHaveLength(2);
  await expect(
    service.submit({
      projectId: project.id,
      commandId: "cancel",
      runId: "one",
      type: "cancel",
      text: "stop",
      workerId: "x",
    }),
  ).rejects.toThrow(/enabled/i);
});
