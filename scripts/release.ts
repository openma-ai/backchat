import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseCommand = {
  command: string;
  args: string[];
};

type ReleaseVerificationInput = {
  platform: NodeJS.Platform;
  appPath?: string;
  artifacts: string[];
  environment: NodeJS.ProcessEnv;
};

type RunProductionReleaseInput = {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
  projectDir: string;
  releaseDir: string;
  runCommand(command: ReleaseCommand): Promise<void>;
  findArtifacts(): Promise<{ appPath?: string; artifacts: string[] }>;
};

const hasValue = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

export function releaseCredentialErrors(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): string[] {
  if (platform === "darwin") {
    const errors: string[] = [];
    const hasInstalledIdentity = hasValue(environment.CSC_NAME);
    const hasImportedIdentity =
      hasValue(environment.CSC_LINK) &&
      hasValue(environment.CSC_KEY_PASSWORD);
    if (!hasInstalledIdentity && !hasImportedIdentity) {
      errors.push(
        "macOS releases require CSC_NAME or CSC_LINK with CSC_KEY_PASSWORD",
      );
    }
    if (
      hasInstalledIdentity &&
      !environment.CSC_NAME!.trim().startsWith("Developer ID Application")
    ) {
      errors.push(
        "macOS CSC_NAME must select a Developer ID Application certificate",
      );
    }
    if (
      !hasValue(environment.APPLE_API_KEY) ||
      !hasValue(environment.APPLE_API_KEY_ID) ||
      !hasValue(environment.APPLE_API_ISSUER)
    ) {
      errors.push(
        "macOS releases require APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER",
      );
    }
    return errors;
  }

  if (platform === "win32") {
    return hasValue(environment.WIN_CSC_LINK) &&
      hasValue(environment.WIN_CSC_KEY_PASSWORD)
      ? []
      : [
          "Windows releases require WIN_CSC_LINK with WIN_CSC_KEY_PASSWORD",
        ];
  }

  if (platform === "linux") {
    return hasValue(environment.BACKCHAT_LINUX_GPG_KEY_ID)
      ? []
      : ["Linux releases require BACKCHAT_LINUX_GPG_KEY_ID"];
  }

  return [`Unsupported release platform: ${platform}`];
}

export function releaseVerificationCommands({
  platform,
  appPath,
  artifacts,
  environment,
}: ReleaseVerificationInput): ReleaseCommand[] {
  if (platform === "darwin") {
    if (!appPath) throw new Error("macOS release verification requires an app path");
    return [
      {
        command: "codesign",
        args: ["--verify", "--deep", "--strict", "--verbose=2", appPath],
      },
      {
        command: "spctl",
        args: ["--assess", "--type", "execute", "--verbose=4", appPath],
      },
      {
        command: "xcrun",
        args: ["stapler", "validate", appPath],
      },
    ];
  }

  if (platform === "win32") {
    return artifacts.map((artifact) => ({
      command: "signtool.exe",
      args: ["verify", "/pa", "/all", "/v", artifact],
    }));
  }

  if (platform === "linux") {
    const keyId = environment.BACKCHAT_LINUX_GPG_KEY_ID?.trim();
    if (!keyId) throw new Error("Linux release verification requires a GPG key id");
    return artifacts.flatMap((artifact) => [
      {
        command: "gpg",
        args: [
          "--batch",
          "--yes",
          "--armor",
          "--detach-sign",
          "--local-user",
          keyId,
          artifact,
        ],
      },
      {
        command: "gpg",
        args: ["--verify", `${artifact}.asc`, artifact],
      },
    ]);
  }

  throw new Error(`Unsupported release platform: ${platform}`);
}

async function walkReleaseDirectory(directory: string): Promise<{
  apps: string[];
  files: string[];
}> {
  const apps: string[] = [];
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".app")) {
        apps.push(path);
      } else {
        const nested = await walkReleaseDirectory(path);
        apps.push(...nested.apps);
        files.push(...nested.files);
      }
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return { apps, files };
}

export async function findReleaseArtifacts(
  platform: NodeJS.Platform,
  releaseDir: string,
): Promise<{ appPath?: string; artifacts: string[] }> {
  const discovered = await walkReleaseDirectory(releaseDir);
  if (platform === "darwin") {
    const appPaths = discovered.apps
      .filter((path) => path.endsWith("/Backchat.app"))
      .sort();
    const artifacts = discovered.files
      .filter((path) => path.endsWith(".dmg"))
      .sort();
    if (appPaths.length !== 1 || artifacts.length === 0) {
      throw new Error("macOS release must contain one Backchat.app and at least one DMG");
    }
    return { appPath: appPaths[0], artifacts };
  }

  if (platform === "win32") {
    const artifacts = discovered.files
      .filter((path) => path.toLowerCase().endsWith(".exe"))
      .sort();
    if (artifacts.length === 0) {
      throw new Error("Windows release must contain signed executables");
    }
    return { artifacts };
  }

  if (platform === "linux") {
    const artifacts = discovered.files
      .filter((path) => path.endsWith(".AppImage"))
      .sort();
    if (artifacts.length === 0) {
      throw new Error("Linux release must contain an AppImage");
    }
    return { artifacts };
  }

  throw new Error(`Unsupported release platform: ${platform}`);
}

export async function runProductionRelease({
  platform,
  environment,
  projectDir: _projectDir,
  releaseDir: _releaseDir,
  runCommand,
  findArtifacts,
}: RunProductionReleaseInput): Promise<void> {
  const credentialErrors = releaseCredentialErrors(platform, environment);
  if (credentialErrors.length > 0) {
    throw new Error(
      `Production release preflight failed:\n${credentialErrors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }

  await runCommand({
    command: "pnpm",
    args: ["exec", "electron-vite", "build"],
  });
  await runCommand({
    command: "pnpm",
    args: [
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.release.yml",
      "--publish",
      "never",
    ],
  });

  const releaseArtifacts = await findArtifacts();
  const verificationCommands = releaseVerificationCommands({
    platform,
    appPath: releaseArtifacts.appPath,
    artifacts: releaseArtifacts.artifacts,
    environment,
  });
  for (const command of verificationCommands) {
    await runCommand(command);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";

if (invokedPath === scriptPath) {
  const projectDir = resolve(dirname(scriptPath), "..");
  const packageMetadata = JSON.parse(
    await readFile(join(projectDir, "package.json"), "utf8"),
  ) as { version?: string };
  if (!packageMetadata.version) {
    throw new Error("package.json must declare a release version");
  }
  const releaseDir = join(projectDir, "release", packageMetadata.version);

  const runCommand = async ({ command, args }: ReleaseCommand): Promise<void> => {
    const executable =
      process.platform === "win32" && command === "pnpm"
        ? "pnpm.cmd"
        : command;
    await new Promise<void>((resolveCommand, rejectCommand) => {
      const child = spawn(executable, args, {
        cwd: projectDir,
        env: process.env,
        stdio: "inherit",
      });
      child.once("error", rejectCommand);
      child.once("exit", (code, signal) => {
        if (code === 0) {
          resolveCommand();
          return;
        }
        rejectCommand(
          new Error(
            `${command} failed${
              signal ? ` with signal ${signal}` : ` with exit code ${String(code)}`
            }`,
          ),
        );
      });
    });
  };

  try {
    await runProductionRelease({
      platform: process.platform,
      environment: process.env,
      projectDir,
      releaseDir,
      runCommand,
      findArtifacts: () => findReleaseArtifacts(process.platform, releaseDir),
    });
    process.stdout.write(`Production release verified: ${releaseDir}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
