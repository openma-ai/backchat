/** Main-owned recovery; deliberately has no session/prompt/process controls. */
export class RendererRecovery {
  #attempts: number[] = [];
  #timer?: ReturnType<typeof setTimeout>;
  #deadline?: ReturnType<typeof setTimeout>;
  #pending = false;
  #disposed = false;
  constructor(private readonly options: {
    reload(): void;
    fallback(): void;
    log(event: string, details: Record<string, unknown>): void;
    isDestroyed(): boolean;
  }) {}
  gone(reason: string): void {
    if (this.#disposed || this.options.isDestroyed() || reason === 'clean-exit') return;
    this.#clear();
    const now = Date.now();
    this.#attempts = this.#attempts.filter(time => now - time < 300_000);
    if (this.#attempts.length >= 2) {this.#fail('crash-loop');return;}
    this.#attempts.push(now);
    this.#pending = true;
    this.options.log('scheduled',{reason,attempt:this.#attempts.length});
    this.#timer = setTimeout(()=>{
      this.#timer = undefined;
      if (this.#disposed || this.options.isDestroyed()) return;
      this.#deadline = setTimeout(()=>this.#fail('load-timeout'),20_000);
      try {this.options.reload();} catch {this.#fail('reload-failed');}
    },500);
  }
  loaded(): void {
    if (!this.#pending || this.#disposed) return;
    this.#clear();
    this.options.log('recovered',{attempt:this.#attempts.length});
  }
  dispose(): void {this.#disposed = true;this.#clear();}
  #clear(): void {
    clearTimeout(this.#timer);clearTimeout(this.#deadline);
    this.#timer = undefined;this.#deadline = undefined;this.#pending = false;
  }
  #fail(reason: string): void {
    this.#clear();
    if (this.#disposed || this.options.isDestroyed()) return;
    this.options.log('failed',{reason});this.options.fallback();
  }
}
