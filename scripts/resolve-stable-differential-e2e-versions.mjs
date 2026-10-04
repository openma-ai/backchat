#!/usr/bin/env node
/**
 * Resolve env for built-client differential e2e against GitHub releases/latest.
 * - TO: latest stable release (non-prerelease vX.Y.Z)
 * - BUILT_START: previous stable; latest release must ship its zip blockmap
 * - SEED_FROM: stable release before BUILT_START (install zip for Squirrel cache)
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  listStableVersions,
  macZipBlockmapName,
  previousStableVersion,
} from "./prepare-stable-release-assets.mjs";

const STABLE_TAG = /^v(\d+)\.\d+\.\d+$/;

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

function fetchLatestStableRelease(env, repository) {
  const result = spawnSync(
    "gh",
    [
      "api",
      `repos/${repository}/releases/latest`,
      "--jq",
      '{tag:.tag_name, prerelease:.prerelease, assets:[.assets[].name]}',
    ],
    { encoding: "utf8", env: ghEnv(env) },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "gh api releases/latest failed");
  }
  const parsed = JSON.parse(result.stdout ?? "{}");
  if (parsed.prerelease) throw new Error(`latest release ${parsed.tag} is prerelease`);
  if (!STABLE_TAG.test(String(parsed.tag ?? ""))) {
    throw new Error(`latest release tag must be vX.Y.Z, got ${JSON.stringify(parsed.tag)}`);
  }
  return { tag: parsed.tag, assets: parsed.assets ?? [] };
}

function releaseHasMacZip(env, repository, tag) {
  const result = spawnSync(
    "gh",
    [
      "api",
      `repos/${repository}/releases/tags/${tag}`,
      "--jq",
      '[.assets[] | select(.name | test("-arm64-mac\\\\.zip$")) | .name] | length',
    ],
    { encoding: "utf8", env: ghEnv(env) },
  );
  if (result.status !== 0) return false;
  return Number(String(result.stdout).trim()) > 0;
}

/** Pure resolution given latest tag, asset names on latest release, and all stable tags. */
export function resolveLiveDifferentialProofVersions({
  latestTag,
  latestReleaseAssets,
  stableTags,
}) {
  const toVersion = latestTag.startsWith("v") ? latestTag.slice(1) : latestTag;
  const versions = listStableVersions(stableTags);
  const builtStartVersion = previousStableVersion(toVersion, versions);
  if (!builtStartVersion) {
    throw new Error(`no stable release before v${toVersion} for built-client hop`);
  }
  const seedFromVersion = previousStableVersion(builtStartVersion, versions);
  if (!seedFromVersion) {
    throw new Error(`no stable release before v${builtStartVersion} to seed Squirrel cache`);
  }

  const blockmapOnLatest = macZipBlockmapName(builtStartVersion);
  if (!latestReleaseAssets.includes(blockmapOnLatest)) {
    throw new Error(
      `latest release ${latestTag} missing ${blockmapOnLatest} (required for differential onto ${toVersion})`,
    );
  }

  return {
    toVersion,
    latestTag,
    builtStartVersion,
    seedFromTag: `v${seedFromVersion}`,
    blockmapOnLatest,
  };
}

export function resolveFromGitHub(env = process.env, repository = env.GITHUB_REPOSITORY ?? "openma-ai/backchat") {
  const latest = fetchLatestStableRelease(env, repository);
  const tags = listRemoteStableTags(env, repository);
  const resolved = resolveLiveDifferentialProofVersions({
    latestTag: latest.tag,
    latestReleaseAssets: latest.assets,
    stableTags: tags,
  });
  if (!releaseHasMacZip(env, repository, resolved.seedFromTag)) {
    throw new Error(`${resolved.seedFromTag} has no Backchat-*-arm64-mac.zip for seed install`);
  }
  return resolved;
}

function printGithubEnv(resolved) {
  console.log(`BACKCHAT_STABLE_TO_VERSION=${resolved.toVersion}`);
  console.log(`BACKCHAT_STABLE_BUILT_START_VERSION=${resolved.builtStartVersion}`);
  console.log(`BACKCHAT_STABLE_SEED_FROM_TAG=${resolved.seedFromTag}`);
}

async function main() {
  const format = process.argv.includes("--format")
    ? process.argv[process.argv.indexOf("--format") + 1]
    : "json";
  const resolved = resolveFromGitHub();
  if (format === "github-env") {
    printGithubEnv(resolved);
    return;
  }
  console.log(JSON.stringify(resolved, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
