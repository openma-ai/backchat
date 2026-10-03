#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFile, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMacPackaging, packagedVersion, signingPlan } from "./configure-mac-packaging.mjs";
import { buildNumberFromEnv, channelFromEnv, writeUpdateMetadata } from "./write-update-metadata.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(projectRoot, "package.json");

function builderEnv(base, plan, apiKeyPath) {
  const env = { ...base };
  delete env.APPLE_API_KEY_BASE64;
  if (plan.mode === "developer-id") {
    env.CSC_LINK = (base.MAC_CSC_LINK || base.CSC_LINK).trim();
    env.CSC_KEY_PASSWORD = (base.MAC_CSC_KEY_PASSWORD || base.CSC_KEY_PASSWORD).trim();
    env.APPLE_API_KEY = apiKeyPath;
    env.APPLE_API_KEY_ID = base.APPLE_API_KEY_ID.trim();
    env.APPLE_API_ISSUER = base.APPLE_API_ISSUER.trim();
    env.APPLE_TEAM_ID = base.APPLE_TEAM_ID.trim();
    env.BACKCHAT_MAC_SIGNING = "developer-id";
    delete env.CSC_IDENTITY_AUTO_DISCOVERY;
    return env;
  }
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  env.BACKCHAT_MAC_SIGNING = "adhoc";
  for (const name of [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "MAC_CSC_LINK",
    "MAC_CSC_KEY_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "APPLE_TEAM_ID",
  ]) {
    delete env[name];
  }
  return env;
}

async function apiKeyPath(env) {
  if (env.APPLE_API_KEY?.trim() && !env.APPLE_API_KEY_BASE64?.trim()) return env.APPLE_API_KEY.trim();
  const dir = await mkdtemp(resolve(tmpdir(), "backchat-notarize-"));
  const path = resolve(dir, "AuthKey.p8");
  await writeFile(path, Buffer.from(env.APPLE_API_KEY_BASE64.trim(), "base64"), { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

function runBuilder(env, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", ["exec", "electron-builder", "--publish", "never", ...args], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`electron-builder exited ${code ?? "null"}`));
    });
  });
}

async function main() {
  const original = await readFile(packageJsonPath, "utf8");
  const plan = signingPlan(process.env);
  const channel = channelFromEnv(process.env);
  const build = buildNumberFromEnv(process.env);
  const missing = plan.missing.length === 0 ? "" : ` (missing ${plan.missing.join(", ")})`;
  console.log(`mac signing: ${plan.mode}${missing}`);
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `BACKCHAT_MAC_SIGNING=${plan.mode}\n`);
  }

  let keyPath = "";
  try {
    const pkg = JSON.parse(original);
    const packaged = packagedVersion(pkg.version, channel, build);
    const edited = applyMacPackaging({ ...pkg, version: packaged }, plan);
    const updateChannel = edited.build?.publish?.channel ?? "latest";
    console.log(`mac update info: ${updateChannel}-mac.yml`);
    await writeFile(packageJsonPath, `${JSON.stringify(edited, null, 2)}\n`);
    const env = builderEnv(process.env, plan, plan.mode === "developer-id" ? await apiKeyPath(process.env) : "");
    keyPath = env.APPLE_API_KEY ?? "";
    env.BACKCHAT_UPDATE_CHANNEL = channel;
    await writeUpdateMetadata({
      packageJsonPath,
      outputPath: resolve(projectRoot, "build/update-metadata.json"),
      env,
      cwd: projectRoot,
    });
    const extra = process.argv.slice(2);
    await runBuilder(env, extra);
  } finally {
    await writeFile(packageJsonPath, original);
    if (keyPath.startsWith(tmpdir())) {
      await rm(dirname(keyPath), { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
