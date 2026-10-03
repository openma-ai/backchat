#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

export function channelFromEnv(env) {
  const explicit = env.BACKCHAT_UPDATE_CHANNEL?.trim();
  if (explicit) {
    if (explicit !== "preview" && explicit !== "stable" && explicit !== "dev") {
      throw new Error(`BACKCHAT_UPDATE_CHANNEL must be preview, stable, or dev, got ${explicit}`);
    }
    return explicit;
  }
  const ref = env.GITHUB_REF ?? "";
  if (ref.startsWith("refs/tags/v")) return "stable";
  if (ref === "refs/heads/main") return "preview";
  return "dev";
}

/** GitHub reuses run_number on a re-run, so the attempt is part of the build id. */
export function buildNumberFromEnv(env) {
  const explicit = env.BACKCHAT_UPDATE_BUILD?.trim();
  if (explicit) {
    if (!/^\d+$/.test(explicit)) throw new Error("BACKCHAT_UPDATE_BUILD must be an integer");
    return Number(explicit);
  }
  const run = env.GITHUB_RUN_NUMBER?.trim() ?? "";
  if (!run) return 0;
  if (!/^\d+$/.test(run)) throw new Error("GITHUB_RUN_NUMBER must be an integer");
  const attemptRaw = env.GITHUB_RUN_ATTEMPT?.trim() || "1";
  if (!/^\d+$/.test(attemptRaw)) throw new Error("GITHUB_RUN_ATTEMPT must be an integer");
  const attempt = Number(attemptRaw);
  if (attempt < 1 || attempt >= 1000) {
    throw new Error("GITHUB_RUN_ATTEMPT must be from 1 to 999");
  }
  return Number(run) * 1000 + attempt;
}

export function commitFromEnv(env, cwd) {
  const sha = env.GITHUB_SHA?.trim() ?? "";
  if (/^[a-f0-9]{40}$/.test(sha) || /^[a-f0-9]{64}$/.test(sha)) return sha;
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  const parsed = result.stdout?.trim() ?? "";
  if (result.status === 0 && /^[a-f0-9]{40}$/.test(parsed)) return parsed;
  return "";
}

export async function writeUpdateMetadata({
  packageJsonPath,
  outputPath,
  env,
  cwd,
}) {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`package.json version must be x.y.z, got ${String(pkg.version)}`);
  }
  const metadata = {
    schema: 1,
    channel: channelFromEnv(env),
    version: pkg.version,
    build: buildNumberFromEnv(env),
    commit: commitFromEnv(env, cwd),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

async function main() {
  const outputPath = resolve(projectRoot, process.argv[2] ?? "build/update-metadata.json");
  const metadata = await writeUpdateMetadata({
    packageJsonPath: resolve(projectRoot, "package.json"),
    outputPath,
    env: process.env,
    cwd: projectRoot,
  });
  console.log(`wrote ${outputPath} channel=${metadata.channel} build=${metadata.build}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
