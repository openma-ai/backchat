/** Confirmation must finish before any terminal, session or runner is stopped. */
export class QuitCoordinator {
  #pending = false;
  #finished = false;
  constructor(private options: {
    needsConfirmation(): boolean;
    confirm(): Promise<boolean>;
    dispose(): Promise<void>;
    quit(): void;
  }) {}
  get pending(): boolean { return this.#pending; }
  /** True only on the final app.quit() after cleanup. */
  request(): boolean {
    if (this.#finished) return true;
    if (!this.#pending) {
      this.#pending = true;
      void this.#run();
    }
    return false;
  }
  async #run(): Promise<void> {
    try {
      if (this.options.needsConfirmation() && !await this.options.confirm()) return;
      try { await this.options.dispose(); } catch { /* Exit even if a child already died. */ }
      this.#finished = true;
      this.options.quit();
    } catch { /* A failed dialog is not approval to terminate local work. */ }
    finally { this.#pending = false; }
  }
}
