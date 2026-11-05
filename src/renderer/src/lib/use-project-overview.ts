import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectWorkView } from "@shared/project-work";
import type { ScheduleInfo } from "@shared/schedules";
import { projectResponseText } from "@shared/project-transcript";
import { relatedReviews } from "./related-reviews";
import { SCHEDULES_QUERY_KEY } from "./scheduled-task-presentation";

// project-host's root export includes SQLite/Node code and its status projection
// caps threads at 30. Read URLs from the complete IPC facts with the existing
// review parser instead; never import the host runtime into the renderer.
export function projectPullRequests(view: ProjectWorkView) {
  type AgentEvent = ProjectWorkView["facts"]["agentEvents"][number];
  const turns = new Map<string, AgentEvent[]>();
  for (const event of view.facts.agentEvents) {
    const key = `${event.session_id}:${event.turn_id}`;
    const events = turns.get(key);
    if (events) events.push(event);
    else turns.set(key, [event]);
  }
  return relatedReviews([
    ...view.facts.events.map(event => JSON.stringify(event.payload)),
    ...[...turns.values()].map(projectResponseText),
    ...(view.workspaces ?? []).map(workspace => JSON.stringify(workspace.location)),
  ]);
}

function normalizedPath(path: string): string {
  const windows = /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
  const slashPath = path.replaceAll("\\", "/");
  const parts: string[] = [];
  for (const part of slashPath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const normalized = `${slashPath.startsWith("/") ? "/" : ""}${parts.join("/")}`.replace(/\/+$/, "");
  return windows ? normalized.toLowerCase() : normalized;
}

export function projectRoutines(view: ProjectWorkView, schedules: ScheduleInfo[], sessionIds: string[] = []) {
  const ids = new Set([...sessionIds, ...view.facts.sessions.map(session => session.id)]);
  const roots = [view.project.primary_folder, ...view.project.source_folders]
    .filter(Boolean).map(normalizedPath);
  return schedules.filter(schedule => ids.has(schedule.sourceSessionId) || roots.some(root => {
    const cwd = normalizedPath(schedule.cwd);
    return cwd === root || cwd.startsWith(`${root}/`);
  }));
}

export function useProjectOverview(projectId?: string) {
  const cache = useQueryClient();
  const workspace = useQuery({
    queryKey: ["project-work", projectId],
    queryFn: () => window.backchat.projectWorkView(projectId!),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
  const schedules = useQuery({
    queryKey: SCHEDULES_QUERY_KEY,
    queryFn: () => window.backchat.schedulesList(),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
  const sessions = useQuery({
    queryKey: ["project-overview-sessions", projectId],
    queryFn: () => window.backchat.sessionsList(),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (!projectId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshMembership = false;
    const invalidate = (membership = false) => {
      refreshMembership ||= membership;
      // Coalesce streaming bursts without starving refresh during a long turn.
      // Delay also lets the host persist facts after broadcasting session events.
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void cache.invalidateQueries({ queryKey: ["project-work", projectId] });
        if (refreshMembership) {
          refreshMembership = false;
          void cache.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
          void cache.invalidateQueries({ queryKey: ["project-overview-sessions", projectId] });
        }
      }, 250);
    };
    // ACP session/update is agent -> client, not a cross-session hook. These
    // subscriptions only refresh projections. OpenMatter's durable inbox and
    // coordinator-worker-result context deliver worker outcomes to the agent.
    const offSession = window.backchat.onSessionEvent(event => {
      const view = cache.getQueryData<ProjectWorkView>(["project-work", projectId]);
      const known = cache.getQueryData<Array<{ id: string; project_id: string | null }>>(
        ["project-overview-sessions", projectId],
      );
      if ((event.type === "session.ready" && event.project_id === projectId)
        || view?.facts.sessions.some(session => session.id === event.session_id)
        || known?.some(session => session.id === event.session_id && session.project_id === projectId)) {
        invalidate(event.type !== "session.event");
      }
    });
    const offProjects = window.backchat.onProjectsChanged(() => invalidate(true));
    return () => {
      offSession();
      offProjects();
      clearTimeout(timer);
    };
  }, [cache, projectId]);
  const pullRequests = useMemo(() => workspace.data ? projectPullRequests(workspace.data) : [], [workspace.data]);
  const routines = useMemo(() => workspace.data ? projectRoutines(
    workspace.data, schedules.data ?? [],
    sessions.data?.filter(session => session.project_id === projectId).map(session => session.id),
  ) : [], [workspace.data, schedules.data, sessions.data, projectId]);
  return { workspace, pullRequests, routines, routinesPending: schedules.isPending || sessions.isPending,
    routinesError: schedules.error ?? sessions.error };
}

export type ProjectOverviewTab = "conversation" | "workers" | "library" | "pull-requests" | "routine";
export function useProjectOverviewTab(hasPullRequests: boolean) {
  const [tab, setTab] = useState<ProjectOverviewTab>("conversation");
  useEffect(() => {
    if (tab === "pull-requests" && !hasPullRequests) setTab("workers");
  }, [tab, hasPullRequests]);
  return [tab, setTab] as const;
}
