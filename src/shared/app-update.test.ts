import { describe, expect, it } from "vitest";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_MANIFEST_NAME,
  applyScriptArgs,
  appBundlePathFromExecutable,
  canReplaceInstalledApp,
  canonicalZipName,
  compareSemver,
  isNewerRelease,
  parseUpdateIdentity,
  parseUpdateManifest,
  resolveManifestUrl,
  zipUrlForManifest,
  type UpdateIdentity,
} from "./app-update.js";

const commit = "0123456789abcdef0123456789abcdef01234567";

function identity(overrides: Partial<UpdateIdentity> = {}): UpdateIdentity {
  return {
    version: "0.0.12",
    channel: "preview",
    build: 1000,
    commit,
    ...overrides,
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    channel: "preview",
    version: "0.0.12",
    build: 2001,
    commit,
    zipName: "Backchat-preview-arm64.zip",
    sha256: "a".repeat(64),
    size: 128,
    ...overrides,
  };
}

describe("version comparison", () => {
  it("orders semver and rejects anything that is not x.y.z", () => {
    expect(compareSemver("0.0.12", "0.0.13")).toBeLessThan(0);
    expect(compareSemver("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2", "1.2.0")).toBeNull();
    expect(compareSemver("1.2.3-preview", "1.2.3")).toBeNull();
    expect(compareSemver("01.2.3", "1.2.3")).toBeNull();
  });

  it("treats a greater preview build of the same version as newer, and refuses downgrades", () => {
    expect(isNewerRelease(identity(), identity({ build: 1001 }))).toBe(true);
    expect(isNewerRelease(identity({ build: 1001 }), identity({ build: 1000 }))).toBe(false);
    expect(isNewerRelease(identity(), identity({ version: "0.0.13", build: 1 }))).toBe(true);
    expect(isNewerRelease(identity({ version: "0.0.13" }), identity({ version: "0.0.12", build: 9999 }))).toBe(false);
    expect(isNewerRelease(identity(), identity())).toBe(false);
  });

  it("compares stable releases by semver and ignores the build number", () => {
    const current = identity({ channel: "stable", version: "0.0.12", build: 50 });
    expect(isNewerRelease(current, identity({ channel: "stable", version: "0.0.13", build: 1 }))).toBe(true);
    expect(isNewerRelease(current, identity({ channel: "stable", version: "0.0.12", build: 900 }))).toBe(false);
    expect(isNewerRelease(current, identity({ channel: "stable", version: "0.0.11", build: 900 }))).toBe(false);
  });

  it("does not cross channels or update a development build", () => {
    expect(isNewerRelease(identity(), identity({ channel: "stable", version: "9.0.0" }))).toBe(false);
    expect(isNewerRelease(identity({ channel: "stable" }), identity({ version: "9.0.0" }))).toBe(false);
    expect(isNewerRelease(identity({ channel: "dev" }), identity({ version: "9.0.0", build: 9 }))).toBe(false);
  });
});

describe("channel selection", () => {
  it("points preview and stable at their own release feeds", () => {
    expect(resolveManifestUrl("preview", {})).toBe(
      `https://github.com/openma-ai/backchat/releases/download/preview/${UPDATE_MANIFEST_NAME}`,
    );
    expect(resolveManifestUrl("stable", {})).toBe(
      `https://github.com/openma-ai/backchat/releases/latest/download/${UPDATE_MANIFEST_NAME}`,
    );
    expect(resolveManifestUrl("dev", {})).toBeNull();
  });

  it("honors a loopback manifest override and rejects other hosts", () => {
    const local = "http://127.0.0.1:9876/Backchat-mac-arm64-update.json";
    expect(resolveManifestUrl("preview", { BACKCHAT_UPDATE_MANIFEST_URL: local })).toBe(local);
    expect(() =>
      resolveManifestUrl("preview", { BACKCHAT_UPDATE_MANIFEST_URL: "https://example.com/manifest.json" }),
    ).toThrow(/GitHub release/);
    expect(() =>
      resolveManifestUrl("preview", { BACKCHAT_UPDATE_MANIFEST_URL: "http://127.0.0.1:9@evil/manifest.json" }),
    ).toThrow(/credentials/);
  });

  it("resolves the zip next to the manifest, and the stable latest alias to the version tag", () => {
    const preview = parseUpdateManifest(manifest());
    expect(
      zipUrlForManifest(
        "https://github.com/openma-ai/backchat/releases/download/preview/Backchat-mac-arm64-update.json",
        preview,
      ),
    ).toBe("https://github.com/openma-ai/backchat/releases/download/preview/Backchat-preview-arm64.zip");

    const stable = parseUpdateManifest(manifest({
      channel: "stable",
      version: "0.0.13",
      zipName: "Backchat-0.0.13-arm64.zip",
    }));
    expect(
      zipUrlForManifest(
        "https://github.com/openma-ai/backchat/releases/latest/download/Backchat-mac-arm64-update.json",
        stable,
      ),
    ).toBe("https://github.com/openma-ai/backchat/releases/download/v0.0.13/Backchat-0.0.13-arm64.zip");

    expect(
      zipUrlForManifest("http://127.0.0.1:9/feed/Backchat-mac-arm64-update.json", preview),
    ).toBe("http://127.0.0.1:9/feed/Backchat-preview-arm64.zip");
  });

  it("rejects a manifest whose zip name, channel, or hash is not the published shape", () => {
    expect(parseUpdateManifest(manifest()).zipName).toBe(canonicalZipName("preview", "0.0.12"));
    expect(() => parseUpdateManifest(manifest({ zipName: "../Backchat-preview-arm64.zip" }))).toThrow(/zip name/);
    expect(() => parseUpdateManifest(manifest({ zipName: "Backchat-0.0.12-arm64.zip" }))).toThrow(/zip name/);
    expect(() => parseUpdateManifest(manifest({ sha256: "abc" }))).toThrow(/sha256/);
    expect(() => parseUpdateManifest(manifest({ channel: "dev" }))).toThrow(/channel/);
    expect(() => parseUpdateManifest(manifest({ schema: 2 }))).toThrow(/schema/);
    expect(parseUpdateIdentity({ channel: "nope", build: 1.5, commit: "zz" }, "0.0.12")).toEqual({
      version: "0.0.12",
      channel: "dev",
      build: 0,
      commit: "",
    });
  });
});

describe("where an update may replace the app", () => {
  it("allows only a packaged bundle directly inside /Applications", () => {
    expect(canReplaceInstalledApp({
      platform: "darwin",
      packaged: true,
      appBundlePath: "/Applications/Backchat.app",
    })).toEqual({ ok: true });
    expect(canReplaceInstalledApp({
      platform: "darwin",
      packaged: false,
      appBundlePath: "/Applications/Backchat.app",
    })).toEqual({ ok: false, reason: "dev" });
    expect(canReplaceInstalledApp({
      platform: "darwin",
      packaged: true,
      appBundlePath: "/Users/me/Applications/Backchat.app",
    })).toEqual({ ok: false, reason: "location" });
    expect(canReplaceInstalledApp({
      platform: "linux",
      packaged: true,
      appBundlePath: "/Applications/Backchat.app",
    })).toEqual({ ok: false, reason: "platform" });
  });

  it("finds the .app that contains the executable", () => {
    expect(appBundlePathFromExecutable(
      "/Applications/Backchat.app/Contents/MacOS/Backchat",
      "darwin",
    )).toBe("/Applications/Backchat.app");
    expect(appBundlePathFromExecutable("/usr/bin/backchat", "darwin")).toBeNull();
    expect(appBundlePathFromExecutable(
      "/Applications/Backchat.app/Contents/MacOS/Backchat",
      "linux",
    )).toBeNull();
  });

  it("asks the helper to relaunch with open after this process exits", () => {
    expect(applyScriptArgs({
      scriptPath: "/tmp/apply-mac-update.sh",
      pid: 42,
      app: "/Applications/Backchat.app",
      zip: "/tmp/update.zip",
      backup: "/tmp/Backchat.app.previous",
      log: "/tmp/apply.log",
      relaunch: "open",
    })).toEqual([
      "/tmp/apply-mac-update.sh",
      "--pid",
      "42",
      "--app",
      "/Applications/Backchat.app",
      "--zip",
      "/tmp/update.zip",
      "--backup",
      "/tmp/Backchat.app.previous",
      "--log",
      "/tmp/apply.log",
      "--relaunch",
      "open",
    ]);
  });

  it("checks again a few hours after startup", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
  });
});
