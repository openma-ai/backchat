/**
 * macOS update feed shared by the main process and the release scripts.
 *
 * electron-updater is not used. On macOS it hands the zip to Squirrel.Mac,
 * which checks the new bundle against the running app's designated code
 * requirement. An ad-hoc signature (`identity: "-"`) has no stable Developer
 * ID, so that check cannot succeed across builds.
 */

export const UPDATE_SCHEMA = 1;
export const UPDATE_MANIFEST_NAME = "Backchat-mac-arm64-update.json";
export const PREVIEW_ZIP_NAME = "Backchat-preview-arm64.zip";
export const GITHUB_REPOSITORY = "openma-ai/backchat";
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const UPDATE_STARTUP_DELAY_MS = 20_000;
/** Larger than a current arm64 build, smaller than an unbounded download. */
export const MAX_UPDATE_BYTES = 2 * 1024 * 1024 * 1024;

export type UpdateChannel = "preview" | "stable" | "dev";
export type PublishedChannel = "preview" | "stable";
export type UpdateInstallBlock = "none" | "dev" | "location" | "platform";
export type UpdateErrorCode = "network" | "manifest" | "sha256" | "install";
export type UpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "available"
  | "ready"
  | "upToDate"
  | "error"
  | "installing";

export interface UpdateIdentity {
  version: string;
  channel: UpdateChannel;
  build: number;
  commit: string;
}

export interface UpdateManifest {
  schema: 1;
  channel: PublishedChannel;
  version: string;
  build: number;
  commit: string;
  zipName: string;
  sha256: string;
  size: number;
}

export interface AvailableUpdate {
  version: string;
  build: number;
  commit: string;
}

export interface AppUpdateState {
  version: string;
  channel: UpdateChannel;
  build: number;
  commit: string;
  status: UpdateStatus;
  canInstall: boolean;
  installBlock: UpdateInstallBlock;
  available: AvailableUpdate | null;
  errorCode: UpdateErrorCode | null;
  checkedAt: string | null;
}

export interface ApplyRequest {
  scriptPath: string;
  pid: number;
  app: string;
  zip: string;
  backup: string;
  log: string;
  relaunch: "open";
}

export class UpdateError extends Error {
  readonly code: UpdateErrorCode;

  constructor(code: UpdateErrorCode, message: string) {
    super(message);
    this.name = "UpdateError";
    this.code = code;
  }
}

export function updateErrorCode(error: unknown): UpdateErrorCode {
  return error instanceof UpdateError ? error.code : "network";
}

export function parseSemver(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  const majorText = match[1];
  const minorText = match[2];
  const patchText = match[3];
  if (majorText == null || minorText == null || patchText == null) return null;
  if (![majorText, minorText, patchText].every((part) => /^(0|[1-9]\d*)$/.test(part))) {
    return null;
  }
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (![major, minor, patch].every((part) => Number.isSafeInteger(part))) return null;
  return { major, minor, patch };
}

/** Positive when `left` is newer than `right`. Null when either side is not x.y.z. */
export function compareSemver(left: string, right: string): number | null {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Preview builds share a semver until the next tag, so the monotonic key is
 * the CI build number. Stable builds compare semver only. Channels never mix,
 * and a development build never updates.
 */
export function isNewerRelease(
  current: UpdateIdentity,
  next: Pick<UpdateIdentity, "version" | "channel" | "build">,
): boolean {
  if (current.channel === "dev" || next.channel === "dev") return false;
  if (current.channel !== next.channel) return false;
  const difference = compareSemver(next.version, current.version);
  if (difference == null) return false;
  if (current.channel === "stable") return difference > 0;
  if (difference > 0) return true;
  if (difference < 0) return false;
  return next.build > current.build;
}

export function canonicalZipName(channel: PublishedChannel, version: string): string {
  if (!parseSemver(version)) {
    throw new UpdateError("manifest", "version is not x.y.z");
  }
  if (channel === "preview") return PREVIEW_ZIP_NAME;
  return `Backchat-${version}-arm64.zip`;
}

export function parseUpdateIdentity(value: unknown, version: string): UpdateIdentity {
  const resolvedVersion = parseSemver(version) ? version : "0.0.0";
  if (!value || typeof value !== "object") {
    return { version: resolvedVersion, channel: "dev", build: 0, commit: "" };
  }
  const record = value as Record<string, unknown>;
  const channel: UpdateChannel =
    record["channel"] === "preview" || record["channel"] === "stable" || record["channel"] === "dev"
      ? record["channel"]
      : "dev";
  const buildValue = record["build"];
  const build =
    typeof buildValue === "number" &&
    Number.isSafeInteger(buildValue) &&
    buildValue >= 0
      ? buildValue
      : 0;
  const commitValue = record["commit"];
  const commit =
    typeof commitValue === "string" && /^[a-f0-9]{7,64}$/.test(commitValue)
      ? commitValue
      : "";
  return { version: resolvedVersion, channel, build, commit };
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
  if (!value || typeof value !== "object") {
    throw new UpdateError("manifest", "manifest is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record["schema"] !== UPDATE_SCHEMA) {
    throw new UpdateError("manifest", "unsupported manifest schema");
  }
  if (record["channel"] !== "preview" && record["channel"] !== "stable") {
    throw new UpdateError("manifest", "manifest channel is invalid");
  }
  const channel = record["channel"];
  if (typeof record["version"] !== "string" || !parseSemver(record["version"])) {
    throw new UpdateError("manifest", "manifest version is invalid");
  }
  const version = record["version"];
  const build = record["build"];
  if (typeof build !== "number" || !Number.isSafeInteger(build) || build < 0) {
    throw new UpdateError("manifest", "manifest build is invalid");
  }
  const commit = record["commit"];
  if (
    typeof commit !== "string" ||
    !(/^[a-f0-9]{40}$/.test(commit) || /^[a-f0-9]{64}$/.test(commit))
  ) {
    throw new UpdateError("manifest", "manifest commit is invalid");
  }
  const zipName = record["zipName"];
  if (typeof zipName !== "string" || zipName !== canonicalZipName(channel, version)) {
    throw new UpdateError("manifest", "manifest zip name is invalid");
  }
  const sha256 = record["sha256"];
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new UpdateError("manifest", "manifest sha256 is invalid");
  }
  const size = record["size"];
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_UPDATE_BYTES
  ) {
    throw new UpdateError("manifest", "manifest size is invalid");
  }
  return {
    schema: 1,
    channel,
    version,
    build,
    commit,
    zipName,
    sha256,
    size,
  };
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isAllowedGitHubUpdateUrl(url: URL, repository: string): boolean {
  if (url.protocol !== "https:" || url.hostname !== "github.com") return false;
  const download = `/${repository}/releases/download/`;
  const latest = `/${repository}/releases/latest/download/${UPDATE_MANIFEST_NAME}`;
  return url.pathname.startsWith(download) || url.pathname === latest;
}

/** Rejects anything except this repo's GitHub release assets, or the loopback manifest host. */
export function assertAllowedUpdateUrl(
  target: string,
  manifestUrl: string,
  repository = GITHUB_REPOSITORY,
): void {
  let next: URL;
  let source: URL;
  try {
    next = new URL(target);
    source = new URL(manifestUrl);
  } catch {
    throw new UpdateError("network", "update url is invalid");
  }
  if (next.username || next.password || source.username || source.password) {
    throw new UpdateError("network", "update url cannot include credentials");
  }
  if (isLoopback(source.hostname)) {
    const sameOrigin =
      next.origin === source.origin &&
      (next.protocol === "http:" || next.protocol === "https:");
    if (!sameOrigin || !isLoopback(next.hostname)) {
      throw new UpdateError("network", "update url must stay on the local manifest host");
    }
    return;
  }
  if (!isAllowedGitHubUpdateUrl(next, repository)) {
    throw new UpdateError("network", "update url is not a GitHub release asset");
  }
}

export function resolveManifestUrl(
  channel: UpdateChannel,
  env: NodeJS.ProcessEnv,
  repository = GITHUB_REPOSITORY,
): string | null {
  const override = env["BACKCHAT_UPDATE_MANIFEST_URL"]?.trim();
  if (override) {
    assertAllowedUpdateUrl(override, override, repository);
    return override;
  }
  if (channel === "preview") {
    return `https://github.com/${repository}/releases/download/preview/${UPDATE_MANIFEST_NAME}`;
  }
  if (channel === "stable") {
    return `https://github.com/${repository}/releases/latest/download/${UPDATE_MANIFEST_NAME}`;
  }
  return null;
}

export function zipUrlForManifest(
  manifestUrl: string,
  manifest: UpdateManifest,
  repository = GITHUB_REPOSITORY,
): string {
  let requested: URL;
  try {
    requested = new URL(manifestUrl);
  } catch {
    throw new UpdateError("manifest", "manifest url is invalid");
  }
  const latestPath = `/${repository}/releases/latest/download/${UPDATE_MANIFEST_NAME}`;
  const zipUrl =
    requested.protocol === "https:" &&
    requested.hostname === "github.com" &&
    requested.pathname === latestPath
      ? `https://github.com/${repository}/releases/download/v${manifest.version}/${manifest.zipName}`
      : siblingUrl(requested, manifest.zipName);
  assertAllowedUpdateUrl(zipUrl, manifestUrl, repository);
  return zipUrl;
}

function siblingUrl(url: URL, name: string): string {
  const segments = url.pathname.split("/");
  const last = segments.length - 1;
  if (last < 0 || segments[last] == null) {
    throw new UpdateError("manifest", "manifest url is invalid");
  }
  segments[last] = name;
  const resolved = new URL(url.toString());
  resolved.pathname = segments.join("/");
  resolved.search = "";
  resolved.hash = "";
  return resolved.toString();
}

/**
 * Automatic replacement is only for a packaged macOS app dragged into
 * /Applications. Development and every other location stay put.
 */
export function canReplaceInstalledApp(input: {
  platform: string;
  packaged: boolean;
  appBundlePath: string | null;
}): { ok: true } | { ok: false; reason: Exclude<UpdateInstallBlock, "none"> } {
  if (input.platform !== "darwin") return { ok: false, reason: "platform" };
  if (!input.packaged) return { ok: false, reason: "dev" };
  const bundle = input.appBundlePath?.replace(/\/+$/, "") ?? "";
  const parent = "/Applications/";
  if (!bundle.startsWith(parent) || !bundle.endsWith(".app")) {
    return { ok: false, reason: "location" };
  }
  const name = bundle.slice(parent.length);
  if (name.length === 0 || name.includes("/") || name.includes("..")) {
    return { ok: false, reason: "location" };
  }
  return { ok: true };
}

export function appBundlePathFromExecutable(exePath: string, platform: string): string | null {
  if (platform !== "darwin") return null;
  const normalized = exePath.replaceAll("\\", "/");
  const marker = ".app/Contents/MacOS/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return null;
  return normalized.slice(0, index + ".app".length);
}

export function applyScriptArgs(request: ApplyRequest): string[] {
  return [
    request.scriptPath,
    "--pid",
    String(request.pid),
    "--app",
    request.app,
    "--zip",
    request.zip,
    "--backup",
    request.backup,
    "--log",
    request.log,
    "--relaunch",
    request.relaunch,
  ];
}
