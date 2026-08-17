import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPackage } from "@electron/asar";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = resolve(projectRoot, "build");
const target = resolve(buildRoot, "bundled-npm-runtime");
const archive = resolve(buildRoot, "bundled-npm-runtime.asar");

if (dirname(target) !== buildRoot) {
  throw new Error(`Refusing to replace unexpected runtime path: ${target}`);
}

await rm(target, { recursive: true, force: true });
await rm(archive, { force: true });

const args = [
  "--config.inject-workspace-packages=true",
  "--config.node-linker=hoisted",
  "--filter",
  "@openma/bundled-npm-runtime",
  "deploy",
  "--prod",
  target,
];
const npmExecPath = process.env.npm_execpath;
const result = npmExecPath
  ? spawnSync(process.execPath, [npmExecPath, ...args], {
      cwd: projectRoot,
      stdio: "inherit",
    })
  : spawnSync("pnpm", args, {
      cwd: projectRoot,
      stdio: "inherit",
    });

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Bundled npm runtime deployment failed with exit ${result.status}`);
}

await createPackage(target, archive);
await rm(target, { recursive: true, force: true });
