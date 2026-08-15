#!/usr/bin/env node

import { copyFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const previewTag = "preview";
const previewTitle = "Backchat Preview";
const previewNotes = "Latest successful build from the main branch.";
const previewAssetName = "Backchat-preview-arm64.dmg";

async function findArm64Dmgs(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findArm64Dmgs(path));
    } else if (
      entry.isFile()
      && entry.name.endsWith("-arm64.dmg")
      && entry.name !== previewAssetName
    ) {
      matches.push(path);
    }
  }
  return matches;
}

function runGh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: allowFailure ? "ignore" : "inherit",
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.status === 0;
}

export async function publishPreviewRelease(releaseDirectory) {
  const releaseRoot = resolve(releaseDirectory);
  const candidates = await findArm64Dmgs(releaseRoot);
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one versioned arm64 DMG under ${releaseRoot}; found ${candidates.length}`,
    );
  }

  const previewAsset = resolve(releaseRoot, previewAssetName);
  await copyFile(candidates[0], previewAsset);

  const releaseExists = runGh(["release", "view", previewTag], { allowFailure: true });
  if (!releaseExists) {
    runGh([
      "release",
      "create",
      previewTag,
      previewAsset,
      "--prerelease",
      "--title",
      previewTitle,
      "--notes",
      previewNotes,
    ]);
    return;
  }

  runGh(["release", "upload", previewTag, previewAsset, "--clobber"]);
  runGh([
    "release",
    "edit",
    previewTag,
    "--prerelease",
    "--title",
    previewTitle,
    "--notes",
    previewNotes,
  ]);
}

async function main(argv) {
  if (argv.length > 1) {
    throw new Error("usage: publish-preview-release.mjs [release-directory]");
  }
  await publishPreviewRelease(argv[0] ?? "release");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
