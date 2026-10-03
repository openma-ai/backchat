import { join } from "node:path";
import {
  applyScriptArgs,
  canReplaceInstalledApp,
  isNewerRelease,
  parseUpdateManifest,
  resolveManifestUrl,
  updateErrorCode,
  zipUrlForManifest,
  UpdateError,
  type AppUpdateState,
  type ApplyRequest,
  type UpdateIdentity,
  type UpdateManifest,
} from "../shared/app-update.js";
import { downloadVerifiedFile } from "./app-update-io.js";

export interface UpdateHost {
  confirm(): Promise<boolean>;
  quitInProgress(): boolean;
  spawn(request: ApplyRequest): void;
  /** Quit through the normal barrier so agent children and the control socket close. */
  shutdown(): void;
  scriptPath: string;
  pid: number;
  backupPath: string;
  logPath: string;
}

type Listener = (state: AppUpdateState) => void;

export class AppUpdateController {
  #state: AppUpdateState;
  #listeners = new Set<Listener>();
  #pending: Promise<AppUpdateState> | null = null;
  #zipPath: string | null = null;
  #manifest: UpdateManifest | null = null;
  #installing = false;
  #holding = false;

  constructor(
    private readonly options: {
      identity: UpdateIdentity;
      platform: string;
      packaged: boolean;
      appBundlePath: string | null;
      userDataPath: string;
      env: NodeJS.ProcessEnv;
      fetchImpl?: typeof fetch;
      now?: () => Date;
      repository?: string;
    },
  ) {
    const replacement = canReplaceInstalledApp({
      platform: options.platform,
      packaged: options.packaged,
      appBundlePath: options.appBundlePath,
    });
    this.#state = {
      version: options.identity.version,
      channel: options.identity.channel,
      build: options.identity.build,
      commit: options.identity.commit,
      status: "idle",
      canInstall: replacement.ok,
      installBlock: replacement.ok ? "none" : replacement.reason,
      available: null,
      errorCode: null,
      checkedAt: null,
    };
  }

  get state(): AppUpdateState {
    return this.#state;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  check(): Promise<AppUpdateState> {
    if (this.#installing || this.#holding) return Promise.resolve(this.#state);
    if (this.#pending) return this.#pending;
    this.#pending = this.#check().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async install(host: UpdateHost): Promise<AppUpdateState> {
    if (this.#installing) return this.#state;
    if (this.#state.status !== "ready" || !this.#zipPath || !this.#manifest) {
      throw new UpdateError("install", "update is not ready");
    }
    if (!this.#state.canInstall || !this.options.appBundlePath) {
      throw new UpdateError("install", "this installation cannot be replaced");
    }
    if (host.quitInProgress()) {
      throw new UpdateError("install", "quit is already in progress");
    }
    this.#holding = true;
    try {
      const confirmed = await host.confirm();
      if (!confirmed) return this.#state;
      this.#installing = true;
      this.#emit({ status: "installing", errorCode: null });
      const request: ApplyRequest = {
        scriptPath: host.scriptPath,
        pid: host.pid,
        app: this.options.appBundlePath,
        zip: this.#zipPath,
        backup: host.backupPath,
        log: host.logPath,
        relaunch: "open",
      };
      try {
        host.spawn(request);
      } catch (error) {
        this.#installing = false;
        this.#emit({ status: "error", errorCode: "install" });
        throw error instanceof UpdateError
          ? error
          : new UpdateError("install", "could not start the update helper");
      }
      // The helper waits for this process. Shutdown still runs the quit
      // barrier: session disposal stops agent children, then the control socket closes.
      host.shutdown();
      return this.#state;
    } finally {
      if (!this.#installing) this.#holding = false;
    }
  }

  /** Exposed so a test can assert the helper is launched with the stable argument list. */
  static helperArgs(request: ApplyRequest): string[] {
    return applyScriptArgs(request);
  }

  failInstall(): AppUpdateState {
    this.#installing = false;
    this.#holding = false;
    return this.#emit({ status: "error", errorCode: "install" });
  }

  async #check(): Promise<AppUpdateState> {
    const manifestUrl = resolveManifestUrl(
      this.options.identity.channel,
      this.options.env,
      this.options.repository,
    );
    if (!manifestUrl) {
      return this.#emit({
        status: "idle",
        available: null,
        errorCode: null,
        checkedAt: this.#now(),
      });
    }
    this.#emit({ status: "checking", errorCode: null });
    try {
      const fetchImpl = this.options.fetchImpl ?? fetch;
      let response: Response;
      try {
        response = await fetchImpl(manifestUrl, { redirect: "follow" });
      } catch (error) {
        throw new UpdateError("network", error instanceof Error ? error.message : "check failed");
      }
      if (!response.ok) {
        throw new UpdateError("network", `manifest request failed with status ${response.status}`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new UpdateError("manifest", "manifest is not json");
      }
      const manifest = parseUpdateManifest(body);
      if (manifest.channel !== this.options.identity.channel) {
        throw new UpdateError("manifest", "manifest channel does not match this installation");
      }
      const checkedAt = this.#now();
      if (
        !isNewerRelease(this.options.identity, {
          version: manifest.version,
          channel: manifest.channel,
          build: manifest.build,
        })
      ) {
        this.#zipPath = null;
        this.#manifest = null;
        return this.#emit({
          status: "upToDate",
          available: null,
          errorCode: null,
          checkedAt,
        });
      }
      const available = {
        version: manifest.version,
        build: manifest.build,
        commit: manifest.commit,
      };
      if (!this.#state.canInstall) {
        this.#zipPath = null;
        this.#manifest = null;
        return this.#emit({
          status: "available",
          available,
          errorCode: null,
          checkedAt,
        });
      }
      this.#emit({ status: "downloading", available, errorCode: null, checkedAt });
      const zipUrl = zipUrlForManifest(manifestUrl, manifest, this.options.repository);
      const destination = join(this.options.userDataPath, "updates", manifest.zipName);
      await downloadVerifiedFile({
        url: zipUrl,
        sha256: manifest.sha256,
        size: manifest.size,
        destination,
        fetchImpl,
      });
      this.#zipPath = destination;
      this.#manifest = manifest;
      return this.#emit({
        status: "ready",
        available,
        errorCode: null,
        checkedAt,
      });
    } catch (error) {
      this.#zipPath = null;
      this.#manifest = null;
      return this.#emit({
        status: "error",
        errorCode: updateErrorCode(error),
        checkedAt: this.#now(),
      });
    }
  }

  #now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }

  #emit(patch: Partial<AppUpdateState>): AppUpdateState {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
    return this.#state;
  }
}
