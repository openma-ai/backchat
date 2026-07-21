import type { ScheduleInfo } from "../shared/schedules.js";
import type {
  HarnessCreateScheduleInput,
  HarnessUpdateScheduleInput,
  ScheduleHarnessToolTarget,
} from "./schedule-harness-mcp.js";
import type { ScheduleStore } from "./schedule-store.js";

export interface ScheduleServiceDeps {
  store: ScheduleStore;
  findSession: (taskId: string) => { agent_id: string; cwd: string } | null;
  reschedule: () => void;
}

export class ScheduleService implements ScheduleHarnessToolTarget {
  readonly #store: ScheduleStore;
  readonly #findSession: ScheduleServiceDeps["findSession"];
  readonly #reschedule: ScheduleServiceDeps["reschedule"];

  constructor(deps: ScheduleServiceDeps) {
    this.#store = deps.store;
    this.#findSession = deps.findSession;
    this.#reschedule = deps.reschedule;
  }

  async create(taskId: string, input: HarnessCreateScheduleInput): Promise<ScheduleInfo> {
    const session = this.#findSession(taskId);
    if (!session) throw new Error(`Cannot schedule unknown task: ${taskId}`);
    const created = this.#store.create({
      ...input,
      sourceSessionId: taskId,
      agentId: session.agent_id,
      cwd: session.cwd,
    });
    this.#reschedule();
    return created;
  }

  async list(taskId: string): Promise<ScheduleInfo[]> {
    return this.#store.list().filter((schedule) => schedule.sourceSessionId === taskId);
  }

  async update(taskId: string, input: HarnessUpdateScheduleInput): Promise<ScheduleInfo> {
    const current = this.#owned(taskId, input.id);
    const updated = this.#store.update({
      ...input,
      id: current.id,
    });
    this.#reschedule();
    return updated;
  }

  async delete(taskId: string, id: string): Promise<void> {
    this.#owned(taskId, id);
    this.#store.delete(id);
    this.#reschedule();
  }

  #owned(taskId: string, scheduleId: string): ScheduleInfo {
    const schedule = this.#store.get(scheduleId);
    if (!schedule || schedule.sourceSessionId !== taskId) {
      throw new Error(`Schedule ${scheduleId} does not belong to task ${taskId}`);
    }
    return schedule;
  }
}
