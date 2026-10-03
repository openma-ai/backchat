#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const manifestName = "Backchat-mac-arm64-update.json";
const previewZipName = "Backchat-preview-arm64.zip";

export function canonicalZipName(channel, version) {
  if (channel === "preview") return previewZipName;
  if (channel === "stable") return `Backchat-${version}-arm64.zip`;
  throw new Error(`cannot publish a ${channel} update manifest`);
}

async function walk(directory, visit) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "Backchat.app") {
        await visit(path, entry);
      } else {
        await walk(path, visit);
      }
    } else if (entry.isFile()) {
      await visit(path, entry);
    }
  }
}

async function findPackagedMetadata(releaseDirectory) {
  const matches = [];
  await walk(releaseDirectory, async (path, entry) => {
    if (!entry.isDirectory() || entry.name !== "Backchat.app") return;
    const metadataPath = resolve(path, "Contents", "Resources", "update-metadata.json");
    try {
      await stat(metadataPath);
    } catch {
      return;
    }
    matches.push(metadataPath);
  });
  if (matches.length !== 1) {
    throw new Error(
      `Expected one packaged update-metadata.json under ${releaseDirectory}; found ${matches.length}`,
    );
  }
  return matches[0];
}

function isSourceZip(name) {
  // electron-builder's mac zip omits ${arch} when it matches the runner, so an
  // arm64 GitHub runner emits Backchat-<version>-mac.zip. The dmg name is separate.
  return /^Backchat-.+\.zip$/.test(name);
}

async function findSourceZips(releaseDirectory, destination) {
  const matches = [];
  await walk(releaseDirectory, async (path, entry) => {
    if (!entry.isFile() || !isSourceZip(entry.name)) return;
    if (resolve(path) === destination) return;
    matches.push(path);
  });
  return matches;
}

export async function sha256File(path) {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

export async function writeUpdateManifest(releaseDirectory, { expectChannel } = {}) {
  const releaseRoot = resolve(releaseDirectory);
  const metadataPath = await findPackagedMetadata(releaseRoot);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  if (metadata.schema !== 1) throw new Error("packaged update metadata schema is unsupported");
  if (expectChannel && metadata.channel !== expectChannel) {
    throw new Error(`expected ${expectChannel} update metadata, found ${metadata.channel}`);
  }
  const zipName = canonicalZipName(metadata.channel, metadata.version);
  const destination = resolve(releaseRoot, zipName);
  const sources = await findSourceZips(releaseRoot, destination);
  if (sources.length !== 1) {
    throw new Error(`Expected one arm64 zip under ${releaseRoot}; found ${sources.length}`);
  }
  if (resolve(sources[0]) !== destination) {
    await copyFile(sources[0], destination);
  }
  const sha256 = await sha256File(destination);
  const size = (await stat(destination)).size;
  if (typeof metadata.version !== "string" || !/^\d+\.\d+\.\d+$/.test(metadata.version)) {
    throw new Error("packaged update metadata version must be x.y.z");
  }
  if (
    typeof metadata.commit !== "string" ||
    !(/^[a-f0-9]{40}$/.test(metadata.commit) || /^[a-f0-9]{64}$/.test(metadata.commit))
  ) {
    throw new Error("packaged update metadata is missing a commit sha");
  }
  if (!Number.isInteger(metadata.build) || metadata.build < 0) {
    throw new Error("packaged update metadata build is invalid");
  }
  const manifest = {
    schema: 1,
    channel: metadata.channel,
    version: metadata.version,
    build: metadata.build,
    commit: metadata.commit,
    zipName,
    sha256,
    size,
  };
  const manifestPath = resolve(releaseRoot, manifestName);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, zipPath: destination, manifest };
}

function expectChannel(argv) {
  const index = argv.indexOf("--expect");
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value !== "preview" && value !== "stable") {
    throw new Error("--expect must be preview or stable");
  }
  return value;
}

async function main(argv) {
  const positional = argv.filter((arg, index) => arg !== "--expect" && argv[index - 1] !== "--expect");
  if (positional.length > 1) {
    throw new Error("usage: write-update-manifest.mjs [release-directory] [--expect preview|stable]");
  }
  const written = await writeUpdateManifest(positional[0] ?? "release", {
    expectChannel: expectChannel(argv),
  });
  console.log(`wrote ${written.manifestPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
