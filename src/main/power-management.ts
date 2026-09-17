import type { SessionEventOut } from '../shared/session-events.js';
import type { OpenmaRunnerState } from '../shared/openma.js';

interface PowerOptions {
  blocker: { start(type: 'prevent-app-suspension'): number; stop(id: number): void };
  monitor: { on(event: 'resume', listener: () => void): unknown; removeListener(event: 'resume', listener: () => void): unknown };
  sessionExists?(id: string): boolean;
  onResume(): void;
  onError?(error: unknown): void;
}

/** Host-side power policy. Only live local activity can acquire an assertion;
 * cloud history and remote task status never flow through this boundary. */
export class DesktopPowerManagement {
  #sessions = new Set<string>();
  #hosting = false;
  #assertion: number | undefined;
  #disposed = false;
  #resume = () => { if (!this.#disposed) { this.#sync(); this.options.onResume(); } };
  constructor(private options: PowerOptions) {
    options.monitor.on('resume', this.#resume);
  }
  setRunner(state: Pick<OpenmaRunnerState, 'enabled' | 'hosting'>): void {
    this.#hosting = state.enabled && state.hosting === 'backchat';
    this.#sync();
  }
  handleSessionEvent(event: SessionEventOut): void {
    if (this.#disposed) return;
    if (event.type === 'session.queue_update') {
      if (event.active_turn_id || event.queued.length || event.steering_turn_ids?.length) this.#sessions.add(event.session_id);
      else this.#sessions.delete(event.session_id);
    } else if (event.type === 'session.disposed' || event.type === 'session.restarted'
      || (event.type === 'session.event' && event.openma_event?.type === 'session.terminated')
      || (event.type === 'session.error' && this.options.sessionExists?.(event.session_id) === false)) {
      this.#sessions.delete(event.session_id);
    } else return;
    this.#sync();
  }
  #sync(): void {
    if (this.#disposed) return;
    if (this.#hosting || this.#sessions.size) {
      try { this.#assertion ??= this.options.blocker.start('prevent-app-suspension'); }
      catch (error) { this.options.onError?.(error); }
    } else this.#release();
  }
  #release(): void {
    try { if (this.#assertion !== undefined) this.options.blocker.stop(this.#assertion); }
    catch (error) { this.options.onError?.(error); }
    this.#assertion = undefined;
  }
  dispose(): void {
    this.#disposed = true;
    this.options.monitor.removeListener('resume', this.#resume);
    this.#sessions.clear();
    this.#release();
  }
}
