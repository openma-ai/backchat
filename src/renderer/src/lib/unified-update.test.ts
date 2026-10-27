import { describe, expect, it } from "vitest";
import type { AppUpdateState } from "@shared/app-update";
import {
  agentUpdateSubject,
  appInstallBlockHint,
  appUpdateSubject,
  updateStatusKey,
  type Translate,
} from "./unified-update";

/** A translate stub that returns the key so the mapping stays readable. */
const t: Translate = (key) => String(key);

function appState(overrides: Partial<AppUpdateState> = {}): AppUpdateState {
  return {
    version: "1.0.0",
    channel: "stable",
    build: 0,
    commit: "",
    signed: true,
    status: "idle",
    canInstall: true,
    installBlock: "none",
    available: null,
    errorCode: null,
    checkedAt: null,
    progress: null,
    ...overrides,
  };
}

describe("unified update vocabulary", () => {
  it("gives every status one shared word", () => {
    expect(updateStatusKey("idle")).toBe("update.status.idle");
    expect(updateStatusKey("checking")).toBe("update.status.checking");
    expect(updateStatusKey("upToDate")).toBe("update.status.upToDate");
    expect(updateStatusKey("updateAvailable")).toBe("update.status.updateAvailable");
    expect(updateStatusKey("downloading")).toBe("update.status.downloading");
    expect(updateStatusKey("ready")).toBe("update.status.ready");
    expect(updateStatusKey("upgrading")).toBe("update.status.upgrading");
    expect(updateStatusKey("restarting")).toBe("update.status.restarting");
    expect(updateStatusKey("error")).toBe("update.status.error");
  });

  it("maps the App states onto that vocabulary", () => {
    expect(appUpdateSubject(appState(), t).status).toBe("idle");
    expect(appUpdateSubject(appState({ status: "checking" }), t).status).toBe("checking");
    expect(appUpdateSubject(appState({ status: "upToDate" }), t).status).toBe("upToDate");
    expect(
      appUpdateSubject(
        appState({
          status: "available",
          available: { version: "1.1.0", build: 0, commit: "" },
        }),
        t,
      ).status,
    ).toBe("updateAvailable");
    expect(appUpdateSubject(appState({ status: "ready" }), t).status).toBe("ready");
    expect(appUpdateSubject(appState({ status: "installing" }), t).status).toBe("restarting");
    expect(appUpdateSubject(appState({ status: "error" }), t).status).toBe("error");
  });

  it("carries the download percentage into the subject", () => {
    const subject = appUpdateSubject(
      appState({
        status: "downloading",
        progress: { percent: 42, transferred: 420, total: 1000, bytesPerSecond: 4096 },
      }),
      t,
    );

    expect(subject.status).toBe("downloading");
    expect(subject.busy).toBe(true);
    expect(subject.progress?.percent).toBe(42);
  });

  it("reports a check as busy and a discovered update as idle", () => {
    expect(appUpdateSubject(appState({ status: "checking" }), t).busy).toBe(true);
    expect(
      appUpdateSubject(
        appState({
          status: "available",
          available: { version: "1.1.0", build: 0, commit: "" },
        }),
        t,
      ).busy,
    ).toBe(false);
  });

  it("explains why a build cannot install its own update", () => {
    expect(appInstallBlockHint(appState(), t)).toBeNull();
    expect(
      appInstallBlockHint(appState({ installBlock: "unsigned" }), t),
    ).toBe("update.unsignedBlocked");
    expect(
      appInstallBlockHint(appState({ installBlock: "platform" }), t),
    ).toBe("update.platformBlocked");
  });

  it("maps the agent states onto the same words", () => {
    expect(
      agentUpdateSubject(
        {
          status: "updateAvailable",
          agentId: null,
          agentLabel: null,
          updatesAvailable: 2,
          error: null,
          updatedAt: "",
        },
        t,
      ).status,
    ).toBe("updateAvailable");
    expect(
      agentUpdateSubject(
        {
          status: "upgrading",
          agentId: "codex",
          agentLabel: "Codex",
          updatesAvailable: 1,
          error: null,
          updatedAt: "",
        },
        t,
      ).detail,
    ).toBe("update.agents.upgrading");
  });
});
