/**
 * Keep pi's global settings file out of Backchat model switches.
 *
 * pi-acp 0.1.3 implements ACP `session/set_config_option` (config id `model`
 * or `thinking`) and the legacy `session/set_model` method by calling pi's
 * `setModel` / `setThinkingLevel` with `{ persist: true }`. That writes
 * `defaultModel` and `defaultProvider` (and the thinking default) into
 * `~/.pi/agent/settings.json`. ACP session config options are session-scoped;
 * pi itself can apply a model without persisting (`options.persist` defaults
 * to false), but pi-acp does not expose that path over any ACP method, slash
 * command, or `_meta` flag.
 *
 * Until that exists, a Backchat pi-acp process gets its own agent directory.
 * `settings.json` is a private copy. Every other entry is a symlink back to
 * the user's agent dir, so credentials, models, and sessions stay shared.
 * Model and thinking changes still apply in the running session; the write
 * lands on the copy.
 */

import { copyFile, lstat, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const PI_CODING_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

export function piAgentDirFromArgs(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--agent-dir") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) return undefined;
      return value;
    }
    if (arg?.startsWith("--agent-dir=")) {
      const value = arg.slice("--agent-dir=".length);
      return value || undefined;
    }
  }
  return undefined;
}

export function stripPiAgentDirArgs(args: readonly string[]): string[] {
  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--agent-dir") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--agent-dir=")) continue;
    next.push(arg);
  }
  return next;
}

/** Directory pi-acp would write `settings.json` into for this spawn. */
export function resolvePiAgentDir(input: {
  args?: readonly string[];
  env?: Record<string, string | undefined>;
  homeDir?: string;
}): string {
  const fromArgs = piAgentDirFromArgs(input.args ?? []);
  if (fromArgs) return resolve(fromArgs);
  const fromEnv = input.env?.[PI_CODING_AGENT_DIR_ENV]?.trim();
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv);
  return join(input.homeDir ?? homedir(), ".pi", "agent");
}

export async function createPiAgentSettingsShadow(input: {
  sourceAgentDir: string;
  shadowDir: string;
}): Promise<void> {
  const sourceAgentDir = resolve(input.sourceAgentDir);
  const shadowDir = resolve(input.shadowDir);
  if (shadowDir === sourceAgentDir) {
    throw new Error("pi settings shadow must not replace the user's agent directory");
  }
  await rm(shadowDir, { recursive: true, force: true });
  await mkdir(shadowDir, { recursive: true });

  let names: string[];
  try {
    names = await readdir(sourceAgentDir);
  } catch (error) {
    if (isEnoent(error)) return;
    throw error;
  }

  for (const name of names) {
    if (name.endsWith(".lock")) continue;
    const sourcePath = join(sourceAgentDir, name);
    const shadowPath = join(shadowDir, name);
    const info = await lstat(sourcePath);
    if (name === "settings.json" && (info.isFile() || info.isSymbolicLink())) {
      await copyFile(sourcePath, shadowPath);
      continue;
    }
    await symlink(sourcePath, shadowPath, symlinkType(info));
  }
}

export async function removePiAgentSettingsShadow(
  shadowDir: string | undefined,
): Promise<void> {
  if (!shadowDir) return;
  await rm(shadowDir, { recursive: true, force: true });
}

export async function isolatePiAgentSettingsForSpawn(input: {
  args: readonly string[];
  env: Record<string, string | undefined>;
  shadowDir: string;
  homeDir?: string;
}): Promise<{
  args: string[];
  env: Record<string, string | undefined>;
  shadowDir: string;
  sourceAgentDir: string;
}> {
  const sourceAgentDir = resolvePiAgentDir({
    args: input.args,
    env: input.env,
    homeDir: input.homeDir,
  });
  await createPiAgentSettingsShadow({
    sourceAgentDir,
    shadowDir: input.shadowDir,
  });
  return {
    args: stripPiAgentDirArgs(input.args),
    env: {
      ...input.env,
      [PI_CODING_AGENT_DIR_ENV]: resolve(input.shadowDir),
    },
    shadowDir: resolve(input.shadowDir),
    sourceAgentDir,
  };
}

function symlinkType(info: { isDirectory(): boolean }): "dir" | "junction" | "file" {
  if (!info.isDirectory()) return "file";
  return process.platform === "win32" ? "junction" : "dir";
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT"
  );
}
