export interface StreamTextPacer {
  enqueue(text: string): void;
  flush(): void;
  dispose(): void;
}

interface StreamTextPacerOptions {
  write(text: string): void;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

function nextDelayMs(backlog: number): number {
  if (backlog > 160) return 4;
  if (backlog > 60) return 8;
  return 12;
}

export function createStreamTextPacer({
  write,
  schedule,
  cancel,
}: StreamTextPacerOptions): StreamTextPacer {
  const pending: string[] = [];
  let scheduled: unknown = null;
  let disposed = false;

  const requestTick = () => {
    if (disposed || scheduled !== null || pending.length === 0) return;
    scheduled = schedule(tick, nextDelayMs(pending.length));
  };

  const tick = () => {
    scheduled = null;
    const character = pending.shift();
    if (character !== undefined) write(character);
    requestTick();
  };

  return {
    enqueue(text) {
      if (disposed || !text) return;
      pending.push(...Array.from(text));
      requestTick();
    },
    flush() {
      if (scheduled !== null) {
        cancel(scheduled);
        scheduled = null;
      }
      if (pending.length > 0) {
        write(pending.join(""));
        pending.length = 0;
      }
    },
    dispose() {
      if (disposed) return;
      if (scheduled !== null) cancel(scheduled);
      scheduled = null;
      pending.length = 0;
      disposed = true;
    },
  };
}
