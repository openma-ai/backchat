export interface BrowserResizeSnapshotControllerOptions {
  settleMs: number;
  capture(): Promise<string | null>;
  getCachedSnapshot(): string | null;
  onCacheSnapshot(dataUrl: string): void;
  cancelPicker(): void;
  onSnapshot(dataUrl: string | null): void;
  scheduleTimeout(callback: () => void, delay: number): number;
  cancelTimeout(timerId: number): void;
}

export class BrowserResizeSnapshotController {
  readonly #options: BrowserResizeSnapshotControllerOptions;
  #resizing = false;
  #settleTimer: number | null = null;
  #lifecycleVersion = 0;
  #disposed = false;

  constructor(options: BrowserResizeSnapshotControllerOptions) {
    this.#options = options;
  }

  resize(): void {
    if (this.#disposed) return;
    if (!this.#resizing) {
      this.#resizing = true;
      this.#options.cancelPicker();
      const cached = this.#options.getCachedSnapshot();
      if (cached) {
        this.#options.onSnapshot(cached);
      } else {
        const lifecycleVersion = this.#lifecycleVersion;
        void this.#options.capture().then((dataUrl) => {
          if (
            dataUrl
            && !this.#disposed
            && this.#resizing
            && lifecycleVersion === this.#lifecycleVersion
          ) {
            this.#options.onSnapshot(dataUrl);
          }
        }).catch(() => undefined);
      }
    }

    if (this.#settleTimer !== null) {
      this.#options.cancelTimeout(this.#settleTimer);
    }
    this.#settleTimer = this.#options.scheduleTimeout(
      () => this.#settle(),
      this.#options.settleMs,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#resizing = false;
    this.#lifecycleVersion += 1;
    if (this.#settleTimer !== null) {
      this.#options.cancelTimeout(this.#settleTimer);
      this.#settleTimer = null;
    }
  }

  #settle(): void {
    if (this.#disposed) return;
    this.#settleTimer = null;
    this.#resizing = false;
    this.#options.onSnapshot(null);
    const lifecycleVersion = this.#lifecycleVersion;
    void this.#options.capture().then((dataUrl) => {
      if (
        dataUrl
        && !this.#disposed
        && lifecycleVersion === this.#lifecycleVersion
      ) {
        this.#options.onCacheSnapshot(dataUrl);
      }
    }).catch(() => undefined);
  }
}
