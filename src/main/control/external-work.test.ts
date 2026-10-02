import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createControlApi } from "./handlers.js";
import {
  closeSessionDb,
  getSession,
  archiveSession,
  listSessions,
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
    const source = join(root, "src");
    await mkdir(source);
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
      sources: [source],
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

    const listed = await api.call("work.list", { project_id: project.id }, "cursor killer") as {
      tasks: Array<{ id: string; text: string }>;
    };
    expect(listed.tasks.map((task) => task.text)).toEqual(["Review the branch"]);
    const steered = await api.call("work.steer", {
      project_id: project.id,
      task_id: listed.tasks[0]!.id,
      text: "narrow the diff",
    }, "cursor killer") as { notes: Array<{ kind: string; text: string }> };
    expect(steered.notes).toEqual([expect.objectContaining({ kind: "steer", text: "narrow the diff" })]);
    const transcript = await api.call("work.transcript", {
      project_id: project.id,
      task_id: listed.tasks[0]!.id,
    }, "cursor killer") as { events: Array<{ text?: string }> };
    expect(transcript.events.map((event) => event.text)).toEqual(["Review the branch", "narrow the diff"]);
    const cancelled = await api.call("work.cancel", {
      project_id: project.id,
      task_id: listed.tasks[0]!.id,
    }, "cursor killer") as { status: string };
    expect(cancelled.status).toBe("cancelled");

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
      cwd: source,
      project_id: project.id,
      title: "EVIDENCE_HELLO",
    });
    setSessionExternalClient("sess-kept", "cursor killer");
    const sessions = await api.call("session.list", { project_id: project.id }, "cursor killer") as Array<{ id: string }>;
    expect(sessions.map((session) => session.id)).toEqual(["sess-kept"]);
    expect(getSession("sess-kept")?.title).toBe("EVIDENCE_HELLO");

    await expect(api.call("work.submit", {
      project_id: project.id,
      text: "Built-in still uses the host",
    })).rejects.toThrow(/Configure this project first/);
    expect(submit).toHaveBeenCalledTimes(2);

    const sameProject = await api.call("project.create", {
      name: "Fresh",
      sources: [source],
    }) as { id: string; created: boolean };
    expect(sameProject.created).toBe(false);
    expect(sameProject.id).toBe(project.id);
    await expect(api.call("project.create", {
      name: "Missing",
      sources: [join(root, "nope")],
    })).rejects.toThrow(/does not exist/);
  });

  it("stops and archives sessions before a project is removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-project-remove-"));
    roots.push(root);
    openSessionDb(join(root, "sessions.db"));
    const source = join(root, "src");
    await mkdir(source);
    const disposed: string[] = [];
    const api = createControlApi({
      sessions: {
        dispose: async (id: string) => {
          disposed.push(id);
          archiveSession(id);
        },
      } as never,
    });
    const project = await api.call("project.create", {
      name: "Remove me",
      sources: [source],
    }) as { id: string };
    upsertSession({
      id: "sess-running",
      agent_id: "cursor",
      cwd: join(root, "gone"),
      project_id: project.id,
      workspace_id: "ws-gone",
      title: "still running",
    });
    upsertSession({
      id: "sess-other",
      agent_id: "cursor",
      cwd: source,
      project_id: "project-else",
      title: "leave me",
    });

    const removed = await api.call("project.remove", {
      id: project.id,
      force: true,
    }) as { removed: boolean; disposed_sessions: string[] };

    expect(removed.removed).toBe(true);
    expect(removed.disposed_sessions).toEqual(["sess-running"]);
    expect(disposed).toEqual(["sess-running"]);
    expect(listSessions(20).map((session) => session.id)).toEqual(["sess-other"]);
    expect(getSession("sess-running")?.archived_at).toEqual(expect.any(Number));
  });

  it("reports an unknown agent as invalid arguments", async () => {
    const api = createControlApi({
      sessions: {
        start: async () => ({
          status: "error" as const,
          session_id: "sess",
          message: "unknown ACP agent: nope",
        }),
      } as never,
    });
    await expect(api.call("session.start", {
      agent_id: "nope",
      root: "/tmp",
    })).rejects.toMatchObject({ code: "invalid_args" });
  });
});
