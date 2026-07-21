import { randomUUID } from "node:crypto";

import type { ScheduleInfo } from "../shared/schedules.js";
import type {
  SessionPromptParams,
  SessionStartParams,
  SessionStartResult,
} from "../shared/session-events.js";

export interface ScheduledTaskExecutorDeps {
  start: (input: SessionStartParams) => Promise<SessionStartResult | { status: "ready" }>;
  prompt: (input: SessionPromptParams) => Promise<void>;
  findSession: (sessionId: string) => { acp_session_id: string } | null;
  createId?: () => string;
}

export class ScheduledTaskExecutor {
  readonly #start: ScheduledTaskExecutorDeps["start"];
  readonly #prompt: ScheduledTaskExecutorDeps["prompt"];
  readonly #findSession: ScheduledTaskExecutorDeps["findSession"];
  readonly #createId: NonNullable<ScheduledTaskExecutorDeps["createId"]>;

  constructor(deps: ScheduledTaskExecutorDeps) {
    this.#start = deps.start;
    this.#prompt = deps.prompt;
    this.#findSession = deps.findSession;
    this.#createId = deps.createId ?? randomUUID;
  }

  async execute(schedule: ScheduleInfo): Promise<{ sessionId: string }> {
    const isNewTask = schedule.target === "new_task";
    const sessionId = isNewTask ? this.#createId() : schedule.sourceSessionId;
    const persisted = isNewTask ? null : this.#findSession(sessionId);
    const result = await this.#start(isNewTask
      ? {
          session_id: sessionId,
          agent_id: schedule.agentId,
          cwd: schedule.cwd || undefined,
          workspace_mode: schedule.cwd ? "project" : "managed",
        }
      : {
          session_id: sessionId,
          agent_id: schedule.agentId,
          cwd: schedule.cwd || undefined,
          ...(persisted?.acp_session_id
            ? { resume: { acp_session_id: persisted.acp_session_id } }
            : {}),
        });
    if (result.status !== "ready") {
      throw new Error("Scheduled task could not start its harness");
    }
    await this.#prompt({
      session_id: sessionId,
      turn_id: this.#createId(),
      text: schedule.prompt,
    });
    return { sessionId };
  }
}
