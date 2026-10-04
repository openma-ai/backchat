#!/usr/bin/env node
/**
 * Before `gh release create`, download the previous stable release's macOS zip
 * blockmap into the release tree so `releases/latest/download/Backchat-{prev}-…`
 * resolves for electron-updater differential updates.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseVersion } from "./release-check.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export function compareStableVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function listStableVersions(tags) {
  return tags
    .map((tag) => (tag.startsWith("v") ? tag.slice(1) : tag))
    .filter((version) => parseVersion(version))
    .sort(compareStableVersions);
}

/** Previous stable x.y.z for a tagged release vX.Y.Z. */
export function previousStableVersion(currentVersion, tags) {
  const versions = listStableVersions(tags);
  const index = versions.indexOf(currentVersion);
  if (index <= 0) return null;
  return versions[index - 1];
}

export function macZipBlockmapName(version) {
  return `Backchat-${version}-arm64-mac.zip.blockmap`;
}

export function findMacZip(releaseRoot) {
  const result = spawnSync(
    "find",
    [releaseRoot, "-type", "f", "-name", "Backchat-*-arm64-mac.zip"],
    { encoding: "utf8" },
  );
  const candidates = (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("preview"));
  if (candidates.length !== 1) {
    throw new Error(`expected one stable mac zip under ${releaseRoot}, found ${candidates.join(", ") || "(none)"}`);
  }
  return candidates[0];
}

function ghEnv(env) {
  return { ...env, GH_TOKEN: env.GH_TOKEN ?? env.GITHUB_TOKEN ?? "" };
}

function listRemoteStableTags(env, repository) {
  const result = spawnSync(
    "gh",
    ["api", `repos/${repository}/tags`, "--paginate", "--jq", ".[].name"],
    { encoding: "utf8", env: ghEnv(env) },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "gh api tags failed");
  }
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => STABLE_TAG.test(line));
}

function assetExistsOnRelease(env, repository, tag, assetName) {
  const result = spawnSync(
    "gh",
    [
      "api",
      `repos/${repository}/releases/tags/${tag}`,
      "--jq",
      `.assets[] | select(.name == "${assetName}") | .name`,
    ],
    { encoding: "utf8", env: ghEnv(env) },
  );
  return result.status === 0 && (result.stdout ?? "").trim() === assetName;
}

export function preparePreviousStableBlockmap({
  releaseRoot,
  currentTag,
  env = process.env,
  repository = env.GITHUB_REPOSITORY ?? "openma-ai/backchat",
}) {
  const match = STABLE_TAG.exec(currentTag.trim());
  if (!match) throw new Error(`current tag must be vX.Y.Z, got ${JSON.stringify(currentTag)}`);
  const currentVersion = `${match[1]}.${match[2]}.${match[3]}`;
  const tags = listRemoteStableTags(env, repository);
  const previousVersion = previousStableVersion(currentVersion, tags);
  if (!previousVersion) {
    return { status: "no-previous-stable", message: `no stable release before v${currentVersion}` };
  }

  const assetName = macZipBlockmapName(previousVersion);
  const previousTag = `v${previousVersion}`;
  if (!assetExistsOnRelease(env, repository, previousTag, assetName)) {
    return {
      status: "missing-on-previous-release",
      previousTag,
      assetName,
      message: `${previousTag} has no ${assetName}; differential update from ${previousVersion} may fall back to full download`,
    };
  }

  const zipPath = findMacZip(releaseRoot);
  const dest = join(dirname(zipPath), assetName);
  const cacheDir = join(releaseRoot, ".previous-stable-assets");
  mkdirSync(cacheDir, { recursive: true });
  const cached = join(cacheDir, assetName);
  if (!existsSync(cached)) {
    const dl = spawnSync(
      "gh",
      ["release", "download", previousTag, "-p", assetName, "-D", cacheDir],
      { encoding: "utf8", env: ghEnv(env) },
    );
    if (dl.status !== 0 || !existsSync(cached)) {
      return {
        status: "download-failed",
        previousTag,
        assetName,
        message: `gh release download ${previousTag} ${assetName} failed: ${dl.stderr || dl.stdout}`,
      };
    }
  }
  copyFileSync(cached, dest);
  return { status: "ok", previousTag, assetName, path: dest, previousVersion };
}

function emitWarning(message) {
  console.warn(message);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=stable blockmap helper::${message.replace(/\n/g, " ")}`);
  }
}

async function main() {
  const releaseRoot = resolve(process.argv[2] ?? "release");
  const currentTag = process.env.GITHUB_REF_NAME ?? process.argv[3] ?? "";
  const result = preparePreviousStableBlockmap({ releaseRoot, currentTag });
  const manifestPath = join(releaseRoot, "previous-stable-blockmap.json");
  writeFileSync(manifestPath, `${JSON.stringify(result, null, 2)}\n`);

  if (result.status === "ok") {
    console.log(`prepared ${result.path} from ${result.previousTag}`);
    return;
  }
  emitWarning(result.message ?? result.status);
  console.log(result.message ?? result.status);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
