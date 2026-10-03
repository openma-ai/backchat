/**
 * Channel and install rules for electron-updater.
 *
 * macOS updates go through Squirrel.Mac, which only installs a Developer ID
 * signed and notarized zip. Preview builds publish `preview-mac.yml` on the
 * moving `preview` release. Stable builds publish `latest-mac.yml` on the
 * version tag. The Team ID stays in CI secrets and is never written here.
 */

export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const UPDATE_STARTUP_DELAY_MS = 20_000;
/** Fixed path. Written only when `BACKCHAT_UPDATE_E2E=1`, never a user setting. */
export const UPDATE_E2E_EVIDENCE_PATH = "/tmp/backchat-update-evidence.log";
export const GITHUB_REPOSITORY = "openma-ai/backchat";
export const PREVIEW_MAC_YML = "preview-mac.yml";
export const LATEST_MAC_YML = "latest-mac.yml";

export type UpdateChannel = "preview" | "stable" | "dev";
export type UpdateInstallBlock = "none" | "dev" | "location" | "platform" | "unsigned";
export type UpdateErrorCode = "network" | "manifest" | "checksum" | "install";
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
  signed: boolean;
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
  signed: boolean;
  status: UpdateStatus;
  canInstall: boolean;
  installBlock: UpdateInstallBlock;
  available: AvailableUpdate | null;
  errorCode: UpdateErrorCode | null;
  checkedAt: string | null;
}

export interface UpdateFeed {
  /** Directory URL. electron-updater appends `preview-mac.yml` or `latest-mac.yml`. */
  url: string;
  /** Value assigned to `autoUpdater.channel`. */
  channel: "preview" | "latest";
  fileName: typeof PREVIEW_MAC_YML | typeof LATEST_MAC_YML;
  allowPrerelease: boolean;
}

interface ParsedAppVersion {
  major: number;
  minor: number;
  patch: number;
  /** Null for a stable x.y.z build. */
  previewBuild: number | null;
}

export function parseAppVersion(version: string): ParsedAppVersion | null {
  const preview = /^(\d+)\.(\d+)\.(\d+)-preview\.(\d+)$/.exec(version);
  const release = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const match = preview ?? release;
  if (!match) return null;
  const majorText = match[1];
  const minorText = match[2];
  const patchText = match[3];
  if (majorText == null || minorText == null || patchText == null) return null;
  if (![majorText, minorText, patchText].every((part) => /^(0|[1-9]\d*)$/.test(part))) {
    return null;
  }
  const previewText = preview?.[4];
  if (preview && (previewText == null || !/^(0|[1-9]\d*)$/.test(previewText))) return null;
  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
    previewBuild: previewText == null ? null : Number(previewText),
  };
}

/** Positive when `left` is newer. Matches semver, including `x.y.z` > `x.y.z-preview.N`. */
export function compareAppVersions(left: string, right: string): number | null {
  const a = parseAppVersion(left);
  const b = parseAppVersion(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.previewBuild == null && b.previewBuild == null) return 0;
  if (a.previewBuild == null) return 1;
  if (b.previewBuild == null) return -1;
  return a.previewBuild - b.previewBuild;
}

export function isNewerRelease(current: UpdateIdentity, next: AvailableUpdate): boolean {
  if (current.channel === "dev") return false;
  const difference = compareAppVersions(next.version, current.version);
  return difference != null && difference > 0;
}

export function previewAppVersion(baseVersion: string, build: number): string {
  if (!parseAppVersion(baseVersion) || parseAppVersion(baseVersion)?.previewBuild != null) {
    throw new Error(`Base version must be x.y.z, got ${baseVersion}`);
  }
  if (!Number.isSafeInteger(build) || build <= 0) {
    throw new Error("Preview build number must be a positive integer");
  }
  return `${baseVersion}-preview.${build}`;
}

export function buildFromVersion(version: string): number {
  return parseAppVersion(version)?.previewBuild ?? 0;
}

export function parseUpdateIdentity(value: unknown, version: string): UpdateIdentity {
  const resolved = parseAppVersion(version) ? version : "0.0.0";
  if (!value || typeof value !== "object") {
    return { version: resolved, channel: "dev", build: 0, commit: "", signed: false };
  }
  const record = value as Record<string, unknown>;
  const channel: UpdateChannel =
    record["channel"] === "preview" || record["channel"] === "stable" || record["channel"] === "dev"
      ? record["channel"]
      : "dev";
  const buildValue = record["build"];
  const build =
    typeof buildValue === "number" && Number.isSafeInteger(buildValue) && buildValue >= 0
      ? buildValue
      : buildFromVersion(resolved);
  const commitValue = record["commit"];
  const commit =
    typeof commitValue === "string" && /^[a-f0-9]{7,64}$/.test(commitValue) ? commitValue : "";
  return {
    version: resolved,
    channel,
    build,
    commit,
    signed: record["signed"] === true,
  };
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

/** Test-only. Both env vars are required so a stray accept flag cannot skip the dialog. */
export function shouldAutoAcceptUpdate(env: NodeJS.ProcessEnv): boolean {
  return env["BACKCHAT_UPDATE_E2E"] === "1" && env["BACKCHAT_UPDATE_ACCEPT"] === "1";
}

export function updateEvidencePath(env: NodeJS.ProcessEnv): string | null {
  return env["BACKCHAT_UPDATE_E2E"] === "1" ? UPDATE_E2E_EVIDENCE_PATH : null;
}

export function updateStartupDelayMs(env: NodeJS.ProcessEnv): number {
  return env["BACKCHAT_UPDATE_E2E"] === "1" ? 1_000 : UPDATE_STARTUP_DELAY_MS;
}

export function assertFeedUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("update feed url is invalid");
  }
  if (parsed.username || parsed.password) throw new Error("update feed url cannot include credentials");
  const github = parsed.protocol === "https:" && parsed.hostname === "github.com";
  const loopback = (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopback(parsed.hostname);
  if (!github && !loopback) throw new Error("update feed url is not allowed");
}

export function feedForChannel(
  channel: UpdateChannel,
  env: NodeJS.ProcessEnv,
  repository = GITHUB_REPOSITORY,
): UpdateFeed | null {
  if (channel === "dev") return null;
  const override = env["BACKCHAT_UPDATE_FEED_URL"]?.trim();
  const preview = channel === "preview";
  const url = override
    ? override
    : preview
      ? `https://github.com/${repository}/releases/download/preview`
      : `https://github.com/${repository}/releases/latest/download`;
  assertFeedUrl(url);
  if (override && !isLoopback(new URL(url).hostname) && new URL(url).hostname !== "github.com") {
    throw new Error("update feed url is not allowed");
  }
  return {
    url,
    channel: preview ? "preview" : "latest",
    fileName: preview ? PREVIEW_MAC_YML : LATEST_MAC_YML,
    allowPrerelease: preview,
  };
}

/**
 * Squirrel.Mac can replace only a notarized Developer ID app that lives
 * directly in /Applications. Development, ad-hoc, and other locations stay put.
 */
export function canInstallUpdate(input: {
  platform: string;
  packaged: boolean;
  signed: boolean;
  appBundlePath: string | null;
}): { ok: true } | { ok: false; reason: Exclude<UpdateInstallBlock, "none"> } {
  if (input.platform !== "darwin") return { ok: false, reason: "platform" };
  if (!input.packaged) return { ok: false, reason: "dev" };
  if (!input.signed) return { ok: false, reason: "unsigned" };
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

export function updateErrorCode(error: unknown): UpdateErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/sha512|sha256|checksum/i.test(message)) return "checksum";
  if (/yaml|yml|manifest|channel file|update info/i.test(message)) return "manifest";
  if (/install/i.test(message)) return "install";
  return "network";
}
