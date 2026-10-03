import { projectWorkThreadId } from "@openmatter/project-host";
import type { AgentSession, Turn } from "@openmatter/core";
import type { ProjectWorkView } from "../../shared/project-work.js";
import { loadHistory, listSessions, type PersistedSession } from "../sql-store.js";

function parsePromptText(data: string): string {
  try {
    const parsed = JSON.parse(data) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

function cliSessionsForProject(projectId: string, client: string): PersistedSession[] {
  return listSessions(500).filter((session) =>
    session.project_id === projectId
    && session.external_client === client
    && !session.archived_at,
  );
}

/** Project-work facts for CLI-started sessions that never entered the coordinator store. */
export function externalClientWorkFacts(
  projectId: string,
  client: string,
): { sessions: AgentSession[]; turns: Turn[] } {
  const sessions: AgentSession[] = [];
  const turns: Turn[] = [];
  for (const row of cliSessionsForProject(projectId, client)) {
    const workThreadId = projectWorkThreadId(
      projectId,
      undefined,
      `client:${row.id}`,
    );
    const createdAt = new Date(row.created_at ?? Date.now()).toISOString();
    const lastUsedAt = new Date(row.last_used_at ?? row.created_at ?? Date.now()).toISOString();
    sessions.push({
      id: row.id,
      bindingKey: row.id,
      agentId: row.agent_id,
      authority: client,
      scopeId: projectId,
      workThreadId,
      privacyPartition: client,
      driverId: "backchat-cli",
      generation: 1,
      state: "open",
      createdAt,
      lastUsedAt,
    });
    const history = loadHistory(row.id);
    let turnIndex = 0;
    for (const event of history) {
      if (event.type !== "user_prompt") continue;
      const prompt = parsePromptText(event.data);
      if (!prompt.trim()) continue;
      const turnId = `cli-${row.id}-${turnIndex}`;
      turnIndex += 1;
      const stamp = new Date(event.ts).toISOString();
      turns.push({
        id: turnId,
        sessionId: row.id,
        triggerEventId: String(event.seq),
        contextProjectionId: "",
        contextDigest: prompt.slice(0, 120),
        allow: [],
        state: "completed",
        createdAt: stamp,
        completedAt: stamp,
      });
    }
  }
  return { sessions, turns };
}

export function mergeExternalClientSessionsIntoWorkView<
  T extends Pick<ProjectWorkView, "facts">,
>(
  projectId: string,
  client: string,
  view: T,
): T {
  const { sessions, turns } = externalClientWorkFacts(projectId, client);
  if (sessions.length === 0) return view;
  const existingSessionIds = new Set(view.facts.sessions.map((session) => session.id));
  const mergedSessions = [
    ...view.facts.sessions,
    ...sessions.filter((session) => !existingSessionIds.has(session.id)),
  ];
  const existingTurnIds = new Set(view.facts.turns.map((turn) => turn.id));
  const mergedTurns = [
    ...view.facts.turns,
    ...turns.filter((turn) => !existingTurnIds.has(turn.id)),
  ];
  return {
    ...view,
    facts: {
      ...view.facts,
      sessions: mergedSessions,
      turns: mergedTurns,
    },
  };
}
