import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { makeMockAgentDriver } from "@openmatter/agent-mock";
import { ProjectWorkService } from "./project-work.js";

const roots: string[] = [];
const services: ProjectWorkService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "coordinator-defaults-"));
  roots.push(directory);
  const service = new ProjectWorkService({
    directory,
    getProject: id => id === "p" ? { id, name: "Project", source_folders: [], primary_folder: "", created_at: 1, updated_at: 1 } : null,
    driver: id => makeMockAgentDriver({ id, output: "Done" }).driver,
  });
  services.push(service);
  return service;
}
const message = { projectId: "p", commandId: "first", type: "message" as const, text: "Hello", agentId: "chosen-harness" };
it("starts an unconfigured project using the composer harness and defaults the worker", async () => {
  const service = setup();
  await service.submit(message);
  await service.drain();
  expect(service.config("p")).toMatchObject({ coordinatorAgent: "chosen-harness", workerAgent: "chosen-harness", continuity: "per-scope", controls: ["delegate", "steer", "cancel", "complete"] });
  expect((await service.view("p")).facts.sessions).toHaveLength(1);
});
it("restores all coordinator tools for legacy configs without changing agents or per-run settings", async () => {
  const service = setup();
  service.db.prepare("INSERT INTO openmatter_project_config VALUES (?, ?)").run("p", JSON.stringify({
    projectId: "p", description: "Goal", instructions: "Keep this", context: "Brief", resources: [],
    coordinatorAgent: "legacy", workerAgent: "worker", continuity: "per-run", controls: [], baseRef: "release",
  }));
  await service.submit({ ...message, agentId: undefined, runId: "run-one" });
  await service.drain();
  expect(service.config("p")).toMatchObject({ coordinatorAgent: "legacy", workerAgent: "worker", continuity: "per-run", instructions: "Keep this", baseRef: "release", controls: ["delegate", "steer", "cancel", "complete"] });
  await service.submit({ ...message, commandId: "delegate", runId: "run-one", type: "delegate", workerId: "task", text: "Do it" });
  await service.drain();
  expect((await service.view("p")).facts.sessions).toHaveLength(2);
});
it("defaults an omitted worker on save but retains an existing explicit worker", async () => {
  const service = setup();
  const base = { projectId: "p", description: "", instructions: "", context: "", resources: [], coordinatorAgent: "coordinator", workerAgent: "", continuity: "per-scope" as const, controls: [] };
  expect(await service.save(base)).toMatchObject({ workerAgent: "coordinator", controls: ["delegate", "steer", "cancel", "complete"] });
  expect(await service.save({ ...base, workerAgent: "custom" })).toMatchObject({ workerAgent: "custom" });
});
it("keeps composer run options durably associated with the original message", async () => {
  const service = setup();
  await service.submit({ ...message, configOverrides: { model: "selected-model", thought_level: "high" } });
  expect(service.runConfig("p", "first")).toEqual({ model: "selected-model", thought_level: "high" });
  expect(service.runConfig("p", "missing")).toEqual({});
  await expect(service.submit({ ...message, configOverrides: { model: "different" } })).rejects.toThrow(/reused/i);
});

it("keeps draft settings and requires a runnable harness rather than fabricating one", async () => {
  const service = setup();
  await service.save({ projectId: "p", description: "Draft goal", instructions: "Notes", context: "", resources: [], coordinatorAgent: "", workerAgent: "", continuity: "per-scope", controls: [] });
  await expect(service.submit({ ...message, agentId: " " })).rejects.toThrow(/both agents/);
  await service.submit(message);
  await service.drain();
  expect(service.config("p")).toMatchObject({ description: "Draft goal", instructions: "Notes", coordinatorAgent: "chosen-harness" });
});
it("keeps identical retries idempotent and does not lose their run options", async () => {
  const service = setup();
  const input = { ...message, configOverrides: { model: "selected" } };
  await service.submit(input);
  await service.drain();
  await service.submit(input);
  await service.drain();
  expect((await service.view("p")).facts.turns).toHaveLength(1);
  expect(service.runConfig("p", "first")).toEqual({ model: "selected" });
});
it("reads default run options for legacy messages", async () => {
  const service = setup();
  await service.submit(message);
  expect(service.runConfig("p", "first")).toEqual({});
});
it("rejects adding run options to a legacy command id", async () => {
  const service = setup();
  await service.submit(message);
  await service.drain();
  await expect(service.submit({ ...message, configOverrides: { model: "new" } })).rejects.toThrow(/reused/);
});
it("honors a composer harness change before the first session but keeps an established session's harness", async () => {
  const service = setup();
  await service.save({ projectId: "p", coordinatorAgent: "preset", workerAgent: "worker", description: "", instructions: "", context: "", resources: [], continuity: "per-scope", controls: [] });
  await service.submit(message);
  await service.drain();
  expect(service.config("p")?.coordinatorAgent).toBe("chosen-harness");
  await service.submit({ ...message, commandId: "next", agentId: "other" });
  await service.drain();
  expect(service.config("p")?.coordinatorAgent).toBe("chosen-harness");
});
it("accepts a legacy retry without adding run options", async () => {
  const service = setup();
  await service.submit(message);
  await service.drain();
  await service.submit(message);
  expect(service.runConfig("p", "first")).toEqual({});
});
