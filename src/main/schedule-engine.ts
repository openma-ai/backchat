import type { ScheduleInfo } from "../shared/schedules.js";
import type { ScheduleStore } from "./schedule-store.js";

export interface ScheduleExecutionResult {
  sessionId: string;
}

export interface ScheduleEngineDeps {
  store: ScheduleStore;
  execute: (schedule: ScheduleInfo) => Promise<ScheduleExecutionResult>;
  notify?: (notification: {
    title: string;
    body: string;
    scheduleId: string;
    sessionId?: string;
  }) => void;
}

export class ScheduleEngine {
  readonly #store: ScheduleStore;
  readonly #execute: ScheduleEngineDeps["execute"];
  readonly #notify: NonNullable<ScheduleEngineDeps["notify"]>;
  readonly #running = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: ScheduleEngineDeps) {
    this.#store = deps.store;
    this.#execute = deps.execute;
    this.#notify = deps.notify ?? (() => undefined);
  }

  start(): void {
    this.reschedule();
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  reschedule(): void {
    this.stop();
    const nextRunAt = this.#store.list()
      .filter((schedule) => schedule.status === "active" && schedule.nextRunAt !== null)
      .reduce<number | null>(
        (nearest, schedule) => nearest === null || schedule.nextRunAt! < nearest
          ? schedule.nextRunAt
          : nearest,
        null,
      );
    if (nextRunAt === null) return;
    const delay = Math.min(Math.max(0, nextRunAt - Date.now()), 2_147_483_647);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.runDue().finally(() => this.reschedule());
    }, delay);
  }

  async runDue(at = Date.now()): Promise<void> {
    const due = this.#store.due(at);
    await Promise.all(due.map(async (schedule) => {
      if (this.#running.has(schedule.id)) return;
      const claimed = this.#store.beginRun(schedule.id, at);
      if (!claimed) return;
      this.#running.add(schedule.id);
      try {
        const result = await this.#execute(schedule);
        this.#store.finishRun(claimed.run.id, {
          status: "succeeded",
          sessionId: result.sessionId,
        });
        if (schedule.notificationPolicy === "always") {
          this.#notify({
            title: schedule.name,
            body: "Scheduled task completed",
            scheduleId: schedule.id,
            sessionId: result.sessionId,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#store.finishRun(claimed.run.id, {
          status: "failed",
          error: message,
        });
        if (schedule.notificationPolicy !== "never") {
          this.#notify({
            title: `${schedule.name} failed`,
            body: message,
            scheduleId: schedule.id,
          });
        }
      } finally {
        this.#running.delete(schedule.id);
      }
    }));
  }
}
