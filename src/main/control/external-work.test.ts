import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createControlApi } from "./handlers.js";
import {
  closeSessionDb,
  getSession,
  openSessionDb,
  setSessionExternalClient,
  upsertSession,
} from "../sql-store.js";

const roots: string[] = [];

afterEach(async () => {
  closeSessionDb();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("external coordinator work", () => {
  it("records external work without the built-in coordinator and leaves built-in submit on the host", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-external-work-"));
    roots.push(root);
    openSessionDb(join(root, "sessions.db"));
    const submit = vi.fn(async () => {
      throw new Error("Configure this project first");
    });
    const api = createControlApi({
      work: {
        submit,
        view: async () => ({ config: null, facts: { sessions: [] } }),
        goal: async () => null,
      },
    });
    const project = await api.call("project.create", {
      name: "Fresh",
      sources: ["/tmp/backchat-external-src"],
    }) as { id: string };

    await expect(api.call("work.submit", {
      project_id: project.id,
      text: "Hello from the built-in coordinator",
    })).rejects.toThrow(/Configure this project first/);
    expect(submit).toHaveBeenCalledTimes(1);

    const submitted = await api.call("work.submit", {
      project_id: project.id,
      text: "Review the branch",
      type: "delegate",
      worker_id: "review-1",
    }, "cursor killer") as {
      routed: string;
      external_coordinator: string;
      task: { coordinator_id: string; text: string };
    };
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submitted.routed).toBe("external");
    expect(submitted.external_coordinator).toBe("cursor killer");
    expect(submitted.task.text).toBe("Review the branch");

    const again = await api.call("coordinator.create", {
      project_id: project.id,
      name: "cursor killer",
    }) as { id: string; created: boolean };
    expect(again.created).toBe(false);
    expect(again.id).toBe(submitted.task.coordinator_id);

    const view = await api.call("work.view", { project_id: project.id }) as {
      external_coordinators: Array<{ name: string }>;
      external_tasks: Array<{ text: string; coordinator_name: string }>;
    };
    expect(view.external_coordinators.map((item) => item.name)).toEqual(["cursor killer"]);
    expect(view.external_tasks).toMatchObject([
      { text: "Review the branch", coordinator_name: "cursor killer" },
    ]);

    upsertSession({
      id: "sess-kept",
      agent_id: "fake-cli",
      cwd: "/tmp/backchat-external-src",
      project_id: project.id,
      title: "EVIDENCE_HELLO",
    });
    setSessionExternalClient("sess-kept", "cursor killer");
    const removed = await api.call("coordinator.remove", {
      project_id: project.id,
      name: "cursor killer",
      delete_threads: false,
    }) as { sessions_deleted: string[] };
    expect(removed.sessions_deleted).toEqual([]);
    expect(getSession("sess-kept")?.title).toBe("EVIDENCE_HELLO");

    await expect(api.call("work.submit", {
      project_id: project.id,
      text: "Built-in still uses the host",
    })).rejects.toThrow(/Configure this project first/);
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
