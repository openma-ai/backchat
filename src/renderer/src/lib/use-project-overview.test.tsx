// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectWorkView } from "@shared/project-work";
import type { ScheduleInfo } from "@shared/schedules";
import type { SessionEventOut } from "@shared/session-events";
import { projectPullRequests, projectRoutines, useProjectOverview, useProjectOverviewTab } from "./use-project-overview";

const view = {
  project: { id: "p", primary_folder: "/repo", source_folders: ["/extra"] },
  facts: { sessions: [{ id: "worker" }], events: [], agentEvents: [] },
} as unknown as ProjectWorkView;
const schedule = (id: string, cwd: string, sourceSessionId = "unrelated") => ({
  id, cwd, sourceSessionId, status: "active",
} as ScheduleInfo);

it("deduplicates real PR/MR URLs across project facts and workspace links", () => {
  const data = {
    ...view,
    facts: { ...view.facts,
      events: [{ payload: { pull_request: { html_url: "https://github.com/org/repo/pull/7" } } }],
      agentEvents: [{ type: "agent.message", data: { text: "https://github.com/org/repo/pull/7/files https://git.example/team/repo/-/merge_requests/9" } }],
    },
    workspaces: [{ location: { prUrl: "https://github.com/org/repo/pull/7?tab=files" } }],
  } as unknown as ProjectWorkView;
  expect(projectPullRequests(data).map(review => review.url)).toEqual([
    "https://github.com/org/repo/pull/7", "https://git.example/team/repo/-/merge_requests/9",
  ]);
  expect(projectPullRequests(view)).toEqual([]);
});

it("joins streamed PR links within their own turn", () => {
  const data = { ...view, facts: { ...view.facts, agentEvents: [
    { type: "agent.message_chunk", session_id: "worker", turn_id: "turn", data: { text: "https://github.com/org/" } },
    { type: "agent.message_chunk", session_id: "worker", turn_id: "other", data: { text: "Ignore this" } },
    { type: "agent.message_chunk", session_id: "worker", turn_id: "turn", data: { text: "repo/pull/42" } },
  ] } } as unknown as ProjectWorkView;
  expect(projectPullRequests(data).map(review => review.url)).toEqual(["https://github.com/org/repo/pull/42"]);
});

it("matches Routine by source session or bounded project folder, including Windows paths", () => {
  expect(projectRoutines(view, [
    schedule("worker", "/worktree", "worker"), schedule("chat", "/elsewhere", "chat"),
    schedule("root", "/repo"), schedule("nested", "/extra/sub"),
    schedule("prefix", "/repo-other"), schedule("outside", "/repo/../other"), schedule("unrelated", "/other"),
  ], ["chat"]).map(row => row.id)).toEqual(["worker", "chat", "root", "nested"]);
  const windows = { ...view, project: { ...view.project, primary_folder: "C:\\Repo\\", source_folders: [] } };
  expect(projectRoutines(windows, [schedule("yes", "c:\\repo\\sub"), schedule("no", "C:\\Repo-other")]).map(row => row.id)).toEqual(["yes"]);
});

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("invalidates on project session events and project changes, coalesces bursts and cleans up", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let onSession!: (event: SessionEventOut) => void;
  let onProjects!: () => void;
  const offSession = vi.fn(), offProjects = vi.fn();
  vi.stubGlobal("backchat", undefined);
  window.backchat = {
    projectWorkView: vi.fn().mockResolvedValue(view), schedulesList: vi.fn().mockResolvedValue([]),
    sessionsList: vi.fn().mockResolvedValue([]),
    onSessionEvent: (handler: typeof onSession) => { onSession = handler; return offSession; },
    onProjectsChanged: (handler: typeof onProjects) => { onProjects = handler; return offProjects; },
  } as unknown as typeof window.backchat;
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["project-work", "p"], view);
  const invalidate = vi.spyOn(cache, "invalidateQueries");
  function Probe() { useProjectOverview("p"); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<QueryClientProvider client={cache}><Probe /></QueryClientProvider>));
  await act(async () => {
    onSession({ type: "session.complete", session_id: "unrelated" } as SessionEventOut);
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(invalidate).not.toHaveBeenCalled();
  await act(async () => {
    for (let i = 0; i < 20; i++) onSession({ type: "session.event", session_id: "worker", turn_id: "turn", event: {} });
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(invalidate.mock.calls.filter(([args]) => args?.queryKey?.[0] === "project-work")).toHaveLength(1);
  expect(window.backchat.projectWorkView).toHaveBeenCalledTimes(2);
  await act(async () => { onProjects(); await vi.advanceTimersByTimeAsync(250); });
  expect(window.backchat.projectWorkView).toHaveBeenCalledTimes(3);
  await act(async () => {
    onSession({ type: "session.ready", session_id: "new-worker", project_id: "p" } as SessionEventOut);
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(window.backchat.projectWorkView).toHaveBeenCalledTimes(4);
  await act(async () => { onProjects(); root!.unmount(); });
  root = undefined;
  expect(offSession).toHaveBeenCalledOnce();
  expect(offProjects).toHaveBeenCalledOnce();
  const calls = invalidate.mock.calls.length;
  await vi.advanceTimersByTimeAsync(500);
  expect(invalidate).toHaveBeenCalledTimes(calls);
  cache.clear();
});

it("falls back to Workers when the selected last PR disappears", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  root = createRoot(container);
  let select!: ReturnType<typeof useProjectOverviewTab>[1];
  function Probe({ hasPR }: { hasPR: boolean }) {
    const [tab, setTab] = useProjectOverviewTab(hasPR);
    select = setTab;
    return <span>{tab}</span>;
  }
  await act(async () => root!.render(<Probe hasPR />));
  await act(async () => select("pull-requests"));
  expect(container.textContent).toBe("pull-requests");
  await act(async () => root!.render(<Probe hasPR={false} />));
  expect(container.textContent).toBe("workers");
});
