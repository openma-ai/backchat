import type {
  BrowserElementHoverInfo,
  BrowserElementPickResult,
  BrowserRegionPickResult,
} from "@shared/browser-element-picker.js";

export type BrowserPickerPoint = { x: number; y: number };
export type BrowserPickerRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface BrowserPickerTarget {
  webContentsId: number;
  sessionId: string;
}

export interface BrowserPickerApi {
  begin(input: { webContentsId: number }): Promise<void>;
  cancel(input: { webContentsId: number }): Promise<void>;
  hover(input: {
    webContentsId: number;
    x: number;
    y: number;
  }): Promise<BrowserElementHoverInfo | null>;
  commit(input: {
    webContentsId: number;
  }): Promise<BrowserElementPickResult | null>;
  captureRegion(input: {
    webContentsId: number;
    rect: BrowserPickerRect;
  }): Promise<BrowserRegionPickResult>;
}

export interface BrowserPickerControllerOptions {
  api: BrowserPickerApi;
  getTarget(): BrowserPickerTarget | null;
  scheduleFrame(callback: () => void): number;
  cancelFrame(frameId: number): void;
  onPickingChange(active: boolean): void;
  onHover(hover: BrowserElementHoverInfo | null): void;
  onElementResult(
    sessionId: string,
    result: BrowserElementPickResult,
  ): Promise<void>;
  onRegionResult(
    sessionId: string,
    result: BrowserRegionPickResult,
  ): Promise<void>;
  onRefreshSnapshot(): void;
  onError(stage: "begin" | "element" | "region", error: unknown): void;
}

export class BrowserPickerController {
  readonly #options: BrowserPickerControllerOptions;
  #target: BrowserPickerTarget | null = null;
  #pendingBegin: {
    target: BrowserPickerTarget;
    promise: Promise<boolean>;
  } | null = null;
  #lifecycleVersion = 0;
  #busy = false;
  #pendingHoverPoint: BrowserPickerPoint | null = null;
  #hoverFrame: number | null = null;
  #hoverRequestVersion = 0;
  #disposed = false;

  constructor(options: BrowserPickerControllerOptions) {
    this.#options = options;
  }

  isPicking(): boolean {
    return this.#target !== null;
  }

  isBusy(): boolean {
    return this.#busy;
  }

  begin(): Promise<boolean> {
    this.#disposed = false;
    let target: BrowserPickerTarget | null;
    try {
      target = this.#options.getTarget();
    } catch (error) {
      this.#reset();
      this.#options.onError("begin", error);
      return Promise.resolve(false);
    }
    if (!target) return Promise.resolve(false);
    const pendingBegin = this.#pendingBegin;
    if (
      pendingBegin
      && pendingBegin.target.webContentsId === target.webContentsId
      && pendingBegin.target.sessionId === target.sessionId
    ) {
      return pendingBegin.promise;
    }
    const lifecycleVersion = ++this.#lifecycleVersion;
    const promise = Promise.resolve()
      .then(() => this.#options.api.begin({
        webContentsId: target.webContentsId,
      }))
      .then(async () => {
        if (lifecycleVersion !== this.#lifecycleVersion) {
          const supersedingTarget = this.#pendingBegin?.target ?? this.#target;
          if (supersedingTarget?.webContentsId !== target.webContentsId) {
            await this.#options.api.cancel({
              webContentsId: target.webContentsId,
            }).catch(() => undefined);
          }
          return false;
        }
        this.#pendingBegin = null;
        this.#target = target;
        this.#options.onHover(null);
        this.#options.onPickingChange(true);
        return true;
      })
      .catch((error: unknown) => {
        if (lifecycleVersion !== this.#lifecycleVersion) return false;
        this.#reset();
        this.#options.onError("begin", error);
        return false;
      });
    this.#pendingBegin = { target, promise };
    return promise;
  }

  async cancel(): Promise<void> {
    if (this.#disposed) return;
    const target = this.#target;
    this.#lifecycleVersion += 1;
    this.#reset();
    if (!target) return;
    await this.#options.api.cancel({
      webContentsId: target.webContentsId,
    }).catch(() => undefined);
  }

  requestHover(point: BrowserPickerPoint): void {
    if (this.#disposed) return;
    this.#pendingHoverPoint = point;
    if (this.#hoverFrame !== null || this.#busy) return;
    this.#hoverFrame = this.#options.scheduleFrame(() => {
      this.#hoverFrame = null;
      const nextPoint = this.#pendingHoverPoint;
      const target = this.#target;
      if (!nextPoint || !target || this.#busy) return;
      const requestVersion = ++this.#hoverRequestVersion;
      void this.#options.api.hover({
        webContentsId: target.webContentsId,
        ...nextPoint,
      }).then((hover) => {
        if (
          this.#target?.webContentsId === target.webContentsId
          && this.#target.sessionId === target.sessionId
          && requestVersion === this.#hoverRequestVersion
          && !this.#busy
        ) {
          this.#options.onHover(hover);
        }
      }).catch(() => undefined);
    });
  }

  async commit(point: BrowserPickerPoint): Promise<boolean> {
    const target = this.#target;
    if (this.#disposed || !target || this.#busy) return false;
    this.#busy = true;
    const lifecycleVersion = this.#lifecycleVersion;
    try {
      const hover = await this.#options.api.hover({
        webContentsId: target.webContentsId,
        ...point,
      });
      if (lifecycleVersion !== this.#lifecycleVersion) return false;
      if (!hover) {
        this.#busy = false;
        this.#options.onHover(null);
        return false;
      }
      this.#options.onHover(hover);
      const result = await this.#options.api.commit({
        webContentsId: target.webContentsId,
      });
      if (lifecycleVersion !== this.#lifecycleVersion) return false;
      if (!result) {
        this.#busy = false;
        return false;
      }
      await this.#options.onElementResult(target.sessionId, result);
      if (lifecycleVersion !== this.#lifecycleVersion) return false;
      this.#reset();
      this.#options.onRefreshSnapshot();
      await this.begin();
      return true;
    } catch (error) {
      await this.#options.api.cancel({
        webContentsId: target.webContentsId,
      }).catch(() => undefined);
      this.#lifecycleVersion += 1;
      this.#reset();
      this.#options.onError("element", error);
      return false;
    }
  }

  async captureRegion(rect: BrowserPickerRect): Promise<boolean> {
    const target = this.#target;
    if (this.#disposed || !target || this.#busy) return false;
    this.#busy = true;
    const lifecycleVersion = this.#lifecycleVersion;
    try {
      const result = await this.#options.api.captureRegion({
        webContentsId: target.webContentsId,
        rect,
      });
      if (lifecycleVersion !== this.#lifecycleVersion) return false;
      await this.#options.onRegionResult(target.sessionId, result);
      if (lifecycleVersion !== this.#lifecycleVersion) return false;
      this.#reset();
      this.#options.onRefreshSnapshot();
      await this.begin();
      return true;
    } catch (error) {
      await this.#options.api.cancel({
        webContentsId: target.webContentsId,
      }).catch(() => undefined);
      this.#lifecycleVersion += 1;
      this.#reset();
      this.#options.onError("region", error);
      return false;
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const target = this.#target;
    this.#lifecycleVersion += 1;
    this.#reset();
    if (target) {
      await this.#options.api.cancel({
        webContentsId: target.webContentsId,
      }).catch(() => undefined);
    }
  }

  #reset(): void {
    this.#busy = false;
    this.#pendingHoverPoint = null;
    this.#hoverRequestVersion += 1;
    if (this.#hoverFrame !== null) {
      this.#options.cancelFrame(this.#hoverFrame);
      this.#hoverFrame = null;
    }
    this.#target = null;
    this.#pendingBegin = null;
    this.#options.onHover(null);
    this.#options.onPickingChange(false);
  }
}
