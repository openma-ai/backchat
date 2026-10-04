import { describe, expect, it } from "vitest";
import {
  LATEST_MAC_YML,
  PREVIEW_MAC_YML,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_STARTUP_DELAY_MS,
  appBundlePathFromExecutable,
  canInstallUpdate,
  compareAppVersions,
  electronUpdaterFeedOptions,
  feedForChannel,
  isNewerRelease,
  parseUpdateIdentity,
  previewAppVersion,
  shouldAutoAcceptUpdate,
  updateErrorCode,
  updateEvidencePath,
  updateStartupDelayMs,
  UPDATE_E2E_EVIDENCE_PATH,
  type UpdateIdentity,
} from "./app-update.js";

const commit = "0123456789abcdef0123456789abcdef01234567";

function identity(overrides: Partial<UpdateIdentity> = {}): UpdateIdentity {
  return {
    version: "0.0.12-preview.1000",
    channel: "preview",
    build: 1000,
    commit,
    signed: true,
    ...overrides,
  };
}

describe("version comparison", () => {
  it("orders stable versions and preview build numbers the way electron-updater's semver does", () => {
    expect(compareAppVersions("0.0.13", "0.0.12")).toBeGreaterThan(0);
    expect(compareAppVersions("0.0.12", "0.0.12")).toBe(0);
    expect(compareAppVersions("1.2.3-preview", "1.2.3")).toBeNull();
    expect(compareAppVersions("01.2.3", "1.2.3")).toBeNull();
    expect(compareAppVersions("0.0.12-preview.2", "0.0.12-preview.1")).toBeGreaterThan(0);
    expect(compareAppVersions("0.0.12-preview.1", "0.0.12-preview.2")).toBeLessThan(0);
    expect(compareAppVersions("0.0.12", "0.0.12-preview.99")).toBeGreaterThan(0);
    expect(compareAppVersions("0.0.13-preview.1", "0.0.12-preview.99")).toBeGreaterThan(0);
    expect(previewAppVersion("0.0.12", 42001)).toBe("0.0.12-preview.42001");
  });

  it("treats a greater preview build as newer and refuses a downgrade or a channel change", () => {
    expect(isNewerRelease(identity(), { version: "0.0.12-preview.1001", build: 1001, commit })).toBe(true);
    expect(isNewerRelease(identity({ build: 1001, version: "0.0.12-preview.1001" }), {
      version: "0.0.12-preview.1000",
      build: 1000,
      commit,
    })).toBe(false);
    expect(isNewerRelease(identity({ channel: "stable", version: "0.0.12", build: 1 }), {
      version: "0.0.13",
      build: 0,
      commit,
    })).toBe(true);
    expect(isNewerRelease(identity({ channel: "stable", version: "0.0.12", build: 1 }), {
      version: "0.0.12",
      build: 99,
      commit,
    })).toBe(false);
    expect(isNewerRelease(identity({ channel: "dev" }), {
      version: "9.0.0",
      build: 1,
      commit,
    })).toBe(false);
  });
});

describe("channel selection", () => {
  it("points preview and stable at different macOS update feeds", () => {
    expect(feedForChannel("preview", {})).toMatchObject({
      url: "https://github.com/openma-ai/backchat/releases/download/preview",
      channel: "preview",
      fileName: PREVIEW_MAC_YML,
      allowPrerelease: true,
    });
    expect(feedForChannel("stable", {})).toMatchObject({
      url: "https://github.com/openma-ai/backchat/releases/latest/download",
      channel: "latest",
      fileName: LATEST_MAC_YML,
      allowPrerelease: false,
    });
    expect(feedForChannel("dev", {})).toBeNull();
  });

  it("disables multipart range requests for GitHub generic feeds", () => {
    const feed = feedForChannel("stable", {});
    expect(feed).not.toBeNull();
    expect(electronUpdaterFeedOptions(feed!)).toEqual({
      provider: "generic",
      url: feed!.url,
      useMultipleRangeRequest: false,
    });
  });

  it("auto-accepts an update only for the e2e hook, and keeps the evidence path off the settings UI", () => {
    expect(shouldAutoAcceptUpdate({})).toBe(false);
    expect(shouldAutoAcceptUpdate({ BACKCHAT_UPDATE_ACCEPT: "1" })).toBe(false);
    expect(shouldAutoAcceptUpdate({ BACKCHAT_UPDATE_E2E: "1" })).toBe(false);
    expect(shouldAutoAcceptUpdate({ BACKCHAT_UPDATE_E2E: "1", BACKCHAT_UPDATE_ACCEPT: "1" })).toBe(true);
    expect(updateEvidencePath({})).toBeNull();
    expect(updateEvidencePath({ BACKCHAT_UPDATE_E2E: "1" })).toBe(UPDATE_E2E_EVIDENCE_PATH);
    expect(updateStartupDelayMs({})).toBe(UPDATE_STARTUP_DELAY_MS);
    expect(updateStartupDelayMs({ BACKCHAT_UPDATE_E2E: "1" })).toBe(1_000);
  });

  it("accepts a loopback feed override and rejects other hosts", () => {
    const local = "http://127.0.0.1:9/updates";
    expect(feedForChannel("preview", { BACKCHAT_UPDATE_FEED_URL: local })?.url).toBe(local);
    expect(() => feedForChannel("stable", { BACKCHAT_UPDATE_FEED_URL: "https://example.com/updates" }))
      .toThrow(/not allowed/);
    expect(() => feedForChannel("stable", { BACKCHAT_UPDATE_FEED_URL: "http://127.0.0.1:9@evil/updates" }))
      .toThrow(/credentials/);
  });

  it("reads the signed flag from build metadata", () => {
    expect(parseUpdateIdentity({
      channel: "stable",
      build: 3,
      commit,
      signed: true,
    }, "0.0.12").signed).toBe(true);
    expect(parseUpdateIdentity({ signed: false }, "0.0.12").signed).toBe(false);
    expect(parseUpdateIdentity(undefined, "0.0.12").channel).toBe("dev");
  });
});

describe("where an update may install", () => {
  it("allows only a signed app directly inside /Applications", () => {
    expect(canInstallUpdate({
      platform: "darwin",
      packaged: true,
      signed: true,
      appBundlePath: "/Applications/Backchat.app",
    })).toEqual({ ok: true });
    expect(canInstallUpdate({
      platform: "darwin",
      packaged: false,
      signed: true,
      appBundlePath: "/Applications/Backchat.app",
    })).toEqual({ ok: false, reason: "dev" });
    expect(canInstallUpdate({
      platform: "darwin",
      packaged: true,
      signed: false,
      appBundlePath: "/Applications/Backchat.app",
    })).toEqual({ ok: false, reason: "unsigned" });
    expect(canInstallUpdate({
      platform: "darwin",
      packaged: true,
      signed: true,
      appBundlePath: "/Users/me/Desktop/Backchat.app",
    })).toEqual({ ok: false, reason: "location" });
    expect(canInstallUpdate({
      platform: "linux",
      packaged: true,
      signed: true,
      appBundlePath: "/Applications/Backchat.app",
    })).toEqual({ ok: false, reason: "platform" });
  });

  it("finds the .app that contains the executable", () => {
    expect(appBundlePathFromExecutable(
      "/Applications/Backchat.app/Contents/MacOS/Backchat",
      "darwin",
    )).toBe("/Applications/Backchat.app");
    expect(appBundlePathFromExecutable("/usr/bin/backchat", "darwin")).toBeNull();
  });

  it("checks again a few hours after startup", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
  });

  it("treats an electron-updater checksum failure as a discarded download", () => {
    expect(updateErrorCode(new Error("sha512 checksum mismatch"))).toBe("checksum");
    expect(updateErrorCode(new Error("Cannot find preview-mac.yml"))).toBe("manifest");
  });
});
