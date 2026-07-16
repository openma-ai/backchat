export interface BrowserCaptureImage {
  toPNG(): Buffer;
}

export interface BrowserViewDebugger {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface BrowserViewTarget {
  readonly id: number;
  isDestroyed(): boolean;
  getURL(): string;
  getTitle(): string;
  loadURL(url: string): Promise<void>;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  capturePage(): Promise<BrowserCaptureImage>;
  readonly debugger?: BrowserViewDebugger;
}

export interface BrowserViewEntry {
  sessionId: string;
  tabId: string;
  hostWebContentsId: number;
  target: BrowserViewTarget;
  active: boolean;
}

export interface BrowserViewRegistration {
  sessionId: string;
  tabId: string;
  hostWebContentsId: number;
  target: BrowserViewTarget;
  active: boolean;
}

interface Waiter {
  tabId: string | null;
  activeOnly: boolean;
  resolve: (entry: BrowserViewEntry) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface MissingWaiter {
  tabId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BrowserViewRegistry {
  readonly #tabsBySession = new Map<string, Map<string, BrowserViewEntry>>();
  readonly #activeTabBySession = new Map<string, string>();
  readonly #waitersBySession = new Map<string, Set<Waiter>>();
  readonly #missingWaitersBySession = new Map<string, Set<MissingWaiter>>();

  register(input: BrowserViewRegistration): BrowserViewEntry {
    if (!input.sessionId || !input.tabId) {
      throw new Error("Browser session and tab ids are required");
    }
    if (input.target.isDestroyed()) {
      throw new Error("Browser view is unavailable");
    }

    let tabs = this.#tabsBySession.get(input.sessionId);
    if (!tabs) {
      tabs = new Map();
      this.#tabsBySession.set(input.sessionId, tabs);
    }
    const entry: BrowserViewEntry = {
      ...input,
      active: input.active,
    };
    tabs.set(input.tabId, entry);

    if (input.active || !this.#activeTabBySession.has(input.sessionId)) {
      this.#activeTabBySession.set(input.sessionId, input.tabId);
    }
    this.#syncActiveFlags(input.sessionId);
    this.#flushWaiters(input.sessionId);
    return entry;
  }

  unregister(
    sessionId: string,
    tabId: string,
    targetId: number,
    hostWebContentsId: number,
  ): void {
    const tabs = this.#tabsBySession.get(sessionId);
    const entry = tabs?.get(tabId);
    if (!entry) return;
    this.#assertOwner(entry, hostWebContentsId);
    if (entry.target.id !== targetId) return;

    tabs!.delete(tabId);
    if (tabs!.size === 0) this.#tabsBySession.delete(sessionId);
    if (this.#activeTabBySession.get(sessionId) === tabId) {
      const next = tabs?.keys().next().value as string | undefined;
      if (next) this.#activeTabBySession.set(sessionId, next);
      else this.#activeTabBySession.delete(sessionId);
    }
    this.#syncActiveFlags(sessionId);
    this.#flushMissingWaiters(sessionId);
  }

  setActive(sessionId: string, tabId: string, hostWebContentsId: number): void {
    const entry = this.#tabsBySession.get(sessionId)?.get(tabId);
    if (!entry || entry.target.isDestroyed()) {
      throw new Error("Browser tab is unavailable");
    }
    this.#assertOwner(entry, hostWebContentsId);
    this.#activeTabBySession.set(sessionId, tabId);
    this.#syncActiveFlags(sessionId);
    this.#flushWaiters(sessionId);
  }

  list(sessionId: string): BrowserViewEntry[] {
    const tabs = this.#tabsBySession.get(sessionId);
    if (!tabs) return [];
    for (const [tabId, entry] of tabs) {
      if (entry.target.isDestroyed()) tabs.delete(tabId);
    }
    if (tabs.size === 0) {
      this.#tabsBySession.delete(sessionId);
      this.#activeTabBySession.delete(sessionId);
      return [];
    }
    this.#syncActiveFlags(sessionId);
    return [...tabs.values()];
  }

  active(sessionId: string): BrowserViewEntry | null {
    const activeTabId = this.#activeTabBySession.get(sessionId);
    if (!activeTabId) return null;
    const entry = this.#tabsBySession.get(sessionId)?.get(activeTabId) ?? null;
    if (!entry || entry.target.isDestroyed()) {
      if (entry) {
        this.unregister(
          entry.sessionId,
          entry.tabId,
          entry.target.id,
          entry.hostWebContentsId,
        );
      }
      return this.list(sessionId).find((candidate) => candidate.active) ?? null;
    }
    return entry;
  }

  tab(sessionId: string, tabId: string): BrowserViewEntry | null {
    const entry = this.#tabsBySession.get(sessionId)?.get(tabId) ?? null;
    return entry && !entry.target.isDestroyed() ? entry : null;
  }

  waitFor(sessionId: string, tabId?: string, timeoutMs = 5_000): Promise<BrowserViewEntry> {
    const immediate = tabId ? this.tab(sessionId, tabId) : this.active(sessionId);
    if (immediate) return Promise.resolve(immediate);

    return new Promise<BrowserViewEntry>((resolve, reject) => {
      const waiter: Waiter = {
        tabId: tabId ?? null,
        activeOnly: false,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#removeWaiter(sessionId, waiter);
          reject(new Error("Timed out waiting for the in-app browser tab"));
        }, timeoutMs),
      };
      let waiters = this.#waitersBySession.get(sessionId);
      if (!waiters) {
        waiters = new Set();
        this.#waitersBySession.set(sessionId, waiters);
      }
      waiters.add(waiter);
    });
  }

  waitForActive(sessionId: string, tabId: string, timeoutMs = 5_000): Promise<BrowserViewEntry> {
    const immediate = this.active(sessionId);
    if (immediate?.tabId === tabId) return Promise.resolve(immediate);

    return new Promise<BrowserViewEntry>((resolve, reject) => {
      const waiter: Waiter = {
        tabId,
        activeOnly: true,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#removeWaiter(sessionId, waiter);
          reject(new Error("Timed out waiting for the in-app browser tab to become active"));
        }, timeoutMs),
      };
      let waiters = this.#waitersBySession.get(sessionId);
      if (!waiters) {
        waiters = new Set();
        this.#waitersBySession.set(sessionId, waiters);
      }
      waiters.add(waiter);
    });
  }

  waitForMissing(sessionId: string, tabId: string, timeoutMs = 5_000): Promise<void> {
    if (!this.tab(sessionId, tabId)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: MissingWaiter = {
        tabId,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#removeMissingWaiter(sessionId, waiter);
          reject(new Error("Timed out waiting for the in-app browser tab to close"));
        }, timeoutMs),
      };
      let waiters = this.#missingWaitersBySession.get(sessionId);
      if (!waiters) {
        waiters = new Set();
        this.#missingWaitersBySession.set(sessionId, waiters);
      }
      waiters.add(waiter);
    });
  }

  #assertOwner(entry: BrowserViewEntry, hostWebContentsId: number): void {
    if (entry.hostWebContentsId !== hostWebContentsId) {
      throw new Error("Browser tab does not belong to this window");
    }
  }

  #syncActiveFlags(sessionId: string): void {
    const activeTabId = this.#activeTabBySession.get(sessionId);
    const tabs = this.#tabsBySession.get(sessionId);
    if (!tabs) return;
    for (const entry of tabs.values()) {
      entry.active = entry.tabId === activeTabId;
    }
  }

  #flushWaiters(sessionId: string): void {
    const waiters = this.#waitersBySession.get(sessionId);
    if (!waiters) return;
    for (const waiter of [...waiters]) {
      const entry = waiter.activeOnly
        ? this.active(sessionId)?.tabId === waiter.tabId
          ? this.active(sessionId)
          : null
        : waiter.tabId
          ? this.tab(sessionId, waiter.tabId)
          : this.active(sessionId);
      if (!entry) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(entry);
    }
    if (waiters.size === 0) this.#waitersBySession.delete(sessionId);
  }

  #removeWaiter(sessionId: string, waiter: Waiter): void {
    const waiters = this.#waitersBySession.get(sessionId);
    if (!waiters) return;
    waiters.delete(waiter);
    if (waiters.size === 0) this.#waitersBySession.delete(sessionId);
  }

  #flushMissingWaiters(sessionId: string): void {
    const waiters = this.#missingWaitersBySession.get(sessionId);
    if (!waiters) return;
    for (const waiter of [...waiters]) {
      if (this.tab(sessionId, waiter.tabId)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve();
    }
    if (waiters.size === 0) this.#missingWaitersBySession.delete(sessionId);
  }

  #removeMissingWaiter(sessionId: string, waiter: MissingWaiter): void {
    const waiters = this.#missingWaitersBySession.get(sessionId);
    if (!waiters) return;
    waiters.delete(waiter);
    if (waiters.size === 0) this.#missingWaitersBySession.delete(sessionId);
  }
}
