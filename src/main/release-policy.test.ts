import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type ReleaseModule = {
  releaseCredentialErrors(
    platform: NodeJS.Platform,
    environment: NodeJS.ProcessEnv,
  ): string[];
  releaseVerificationCommands(input: {
    platform: NodeJS.Platform;
    appPath?: string;
    artifacts: string[];
    environment: NodeJS.ProcessEnv;
  }): Array<{ command: string; args: string[] }>;
  runProductionRelease?(input: {
    platform: NodeJS.Platform;
    environment: NodeJS.ProcessEnv;
    projectDir: string;
    releaseDir: string;
    runCommand(command: { command: string; args: string[] }): Promise<void>;
    findArtifacts(): Promise<{ appPath?: string; artifacts: string[] }>;
  }): Promise<void>;
  findReleaseArtifacts?(
    platform: NodeJS.Platform,
    releaseDir: string,
  ): Promise<{ appPath?: string; artifacts: string[] }>;
};

const releaseModuleUrl = new URL("../../scripts/release.ts", import.meta.url).href;
const releaseModule = await import(
  /* @vite-ignore */ releaseModuleUrl
).catch(() => null) as ReleaseModule | null;

describe("production release policy", () => {
  it("rejects unsigned or unnotarized release environments", () => {
    expect(releaseModule).not.toBeNull();
    if (!releaseModule) return;

    expect(releaseModule.releaseCredentialErrors("darwin", {})).toEqual([
      "macOS releases require CSC_NAME or CSC_LINK with CSC_KEY_PASSWORD",
      "macOS releases require APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER",
    ]);
    expect(releaseModule.releaseCredentialErrors("win32", {})).toEqual([
      "Windows releases require WIN_CSC_LINK with WIN_CSC_KEY_PASSWORD",
    ]);
    expect(releaseModule.releaseCredentialErrors("linux", {})).toEqual([
      "Linux releases require BACKCHAT_LINUX_GPG_KEY_ID",
    ]);
  });

  it("accepts complete platform signing credentials", () => {
    expect(releaseModule).not.toBeNull();
    if (!releaseModule) return;

    expect(
      releaseModule.releaseCredentialErrors("darwin", {
        CSC_LINK: "/run/secrets/backchat-mac.p12",
        CSC_KEY_PASSWORD: "secret",
        APPLE_API_KEY: "/run/secrets/AuthKey.p8",
        APPLE_API_KEY_ID: "KEY123",
        APPLE_API_ISSUER: "issuer-id",
      }),
    ).toEqual([]);
    expect(
      releaseModule.releaseCredentialErrors("win32", {
        WIN_CSC_LINK: "C:\\secrets\\backchat.pfx",
        WIN_CSC_KEY_PASSWORD: "secret",
      }),
    ).toEqual([]);
    expect(
      releaseModule.releaseCredentialErrors("linux", {
        BACKCHAT_LINUX_GPG_KEY_ID: "release@openma.dev",
      }),
    ).toEqual([]);
  });

  it("rejects a development-only macOS identity for a production release", () => {
    expect(releaseModule).not.toBeNull();
    if (!releaseModule) return;

    expect(
      releaseModule.releaseCredentialErrors("darwin", {
        CSC_NAME: "Apple Development: Developer (TEAM123456)",
        APPLE_API_KEY: "/run/secrets/AuthKey.p8",
        APPLE_API_KEY_ID: "KEY123",
        APPLE_API_ISSUER: "issuer-id",
      }),
    ).toEqual([
      "macOS CSC_NAME must select a Developer ID Application certificate",
    ]);
  });

  it("verifies each platform with its native trust tooling", () => {
    expect(releaseModule).not.toBeNull();
    if (!releaseModule) return;

    expect(
      releaseModule.releaseVerificationCommands({
        platform: "darwin",
        appPath: "/release/Backchat.app",
        artifacts: ["/release/Backchat.dmg"],
        environment: {},
      }),
    ).toEqual([
      {
        command: "codesign",
        args: ["--verify", "--deep", "--strict", "--verbose=2", "/release/Backchat.app"],
      },
      {
        command: "spctl",
        args: ["--assess", "--type", "execute", "--verbose=4", "/release/Backchat.app"],
      },
      {
        command: "xcrun",
        args: ["stapler", "validate", "/release/Backchat.app"],
      },
    ]);

    expect(
      releaseModule.releaseVerificationCommands({
        platform: "win32",
        artifacts: ["C:\\release\\Backchat.exe"],
        environment: {},
      }),
    ).toEqual([
      {
        command: "signtool.exe",
        args: ["verify", "/pa", "/all", "/v", "C:\\release\\Backchat.exe"],
      },
    ]);

    expect(
      releaseModule.releaseVerificationCommands({
        platform: "linux",
        artifacts: ["/release/Backchat.AppImage"],
        environment: { BACKCHAT_LINUX_GPG_KEY_ID: "release@openma.dev" },
      }),
    ).toEqual([
      {
        command: "gpg",
        args: [
          "--batch",
          "--yes",
          "--armor",
          "--detach-sign",
          "--local-user",
          "release@openma.dev",
          "/release/Backchat.AppImage",
        ],
      },
      {
        command: "gpg",
        args: ["--verify", "/release/Backchat.AppImage.asc", "/release/Backchat.AppImage"],
      },
    ]);
  });

  it("stops a release before building when production credentials are missing", async () => {
    expect(releaseModule?.runProductionRelease).toBeTypeOf("function");
    if (!releaseModule?.runProductionRelease) return;
    const commands: Array<{ command: string; args: string[] }> = [];

    await expect(
      releaseModule.runProductionRelease({
        platform: "darwin",
        environment: {},
        projectDir: "/repo",
        releaseDir: "/repo/release/1.0.0",
        runCommand: async (command) => {
          commands.push(command);
        },
        findArtifacts: async () => ({ artifacts: [] }),
      }),
    ).rejects.toThrow(
      "Production release preflight failed:\n- macOS releases require CSC_NAME or CSC_LINK with CSC_KEY_PASSWORD\n- macOS releases require APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER",
    );
    expect(commands).toEqual([]);
  });

  it("builds with the release config before verifying native artifacts", async () => {
    expect(releaseModule?.runProductionRelease).toBeTypeOf("function");
    if (!releaseModule?.runProductionRelease) return;
    const commands: Array<{ command: string; args: string[] }> = [];

    await releaseModule.runProductionRelease({
      platform: "darwin",
      environment: {
        CSC_NAME: "Developer ID Application: OpenMA (TEAM123456)",
        APPLE_API_KEY: "/run/secrets/AuthKey.p8",
        APPLE_API_KEY_ID: "KEY123",
        APPLE_API_ISSUER: "issuer-id",
      },
      projectDir: "/repo",
      releaseDir: "/repo/release/1.0.0",
      runCommand: async (command) => {
        commands.push(command);
      },
      findArtifacts: async () => ({
        appPath: "/repo/release/1.0.0/mac-arm64/Backchat.app",
        artifacts: ["/repo/release/1.0.0/Backchat-1.0.0-mac-arm64.dmg"],
      }),
    });

    expect(commands).toEqual([
      {
        command: "pnpm",
        args: ["exec", "electron-vite", "build"],
      },
      {
        command: "pnpm",
        args: [
          "exec",
          "electron-builder",
          "--config",
          "electron-builder.release.yml",
          "--publish",
          "never",
        ],
      },
      {
        command: "codesign",
        args: [
          "--verify",
          "--deep",
          "--strict",
          "--verbose=2",
          "/repo/release/1.0.0/mac-arm64/Backchat.app",
        ],
      },
      {
        command: "spctl",
        args: [
          "--assess",
          "--type",
          "execute",
          "--verbose=4",
          "/repo/release/1.0.0/mac-arm64/Backchat.app",
        ],
      },
      {
        command: "xcrun",
        args: [
          "stapler",
          "validate",
          "/repo/release/1.0.0/mac-arm64/Backchat.app",
        ],
      },
    ]);
  });

  it("discovers only the native artifacts that each release must verify", async () => {
    expect(releaseModule?.findReleaseArtifacts).toBeTypeOf("function");
    if (!releaseModule?.findReleaseArtifacts) return;
    const releaseDir = await mkdtemp(join(tmpdir(), "backchat-release-"));
    const macApp = join(releaseDir, "mac-arm64", "Backchat.app");
    const dmg = join(releaseDir, "Backchat-1.0.0-mac-arm64.dmg");
    const unpackedExe = join(releaseDir, "win-unpacked", "Backchat.exe");
    const installerExe = join(releaseDir, "Backchat-Setup-1.0.0.exe");
    const appImage = join(releaseDir, "Backchat-1.0.0-linux-x64.AppImage");
    await mkdir(macApp, { recursive: true });
    await mkdir(join(releaseDir, "win-unpacked"), { recursive: true });
    await Promise.all([
      writeFile(dmg, "dmg"),
      writeFile(unpackedExe, "exe"),
      writeFile(installerExe, "installer"),
      writeFile(appImage, "appimage"),
      writeFile(join(releaseDir, "builder-effective-config.yaml"), "config"),
    ]);

    await expect(
      releaseModule.findReleaseArtifacts("darwin", releaseDir),
    ).resolves.toEqual({ appPath: macApp, artifacts: [dmg] });
    await expect(
      releaseModule.findReleaseArtifacts("win32", releaseDir),
    ).resolves.toEqual({ artifacts: [installerExe, unpackedExe] });
    await expect(
      releaseModule.findReleaseArtifacts("linux", releaseDir),
    ).resolves.toEqual({ artifacts: [appImage] });
  });
});
