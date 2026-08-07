#!/usr/bin/env node

import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  generateHarnessFeatureMatrixDraftReport,
  generateHarnessFeatureMatrixReport,
} from "./generate-harness-feature-matrix-report.mjs";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/;

async function validatePng(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 24) throw new Error(`Broken screenshot: ${path}`);
  const bytes = await readFile(path);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Screenshot is not a PNG: ${path}`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) throw new Error(`Screenshot has zero dimensions: ${path}`);
  if (SECRET_PATTERN.test(bytes.toString("latin1"))) {
    throw new Error(`Secret-shaped material found in screenshot bytes: ${path}`);
  }
  return {
    width,
    height,
    bytes: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function validateHarnessFeatureMatrixArtifactsWithReport(
  stagingRoot,
  generateReport,
) {
  const root = resolve(stagingRoot);
  const manifestPath = resolve(root, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  if (SECRET_PATTERN.test(manifestText)) {
    throw new Error("Secret-shaped credential material found in staging manifest");
  }
  const manifest = JSON.parse(manifestText);
  const html = generateReport(manifest);
  if (SECRET_PATTERN.test(html)) {
    throw new Error("Secret-shaped credential material found in generated HTML");
  }

  const screenshots = [];
  const screenshotPaths = new Set();
  for (const cell of manifest.cells) {
    const screenshot = resolve(root, cell.screenshot);
    if (screenshot !== root && !screenshot.startsWith(`${root}${sep}`)) {
      throw new Error(`Screenshot escapes staging root: ${cell.screenshot}`);
    }
    screenshots.push({
      feature: cell.feature,
      harness: cell.harness,
      path: relative(root, screenshot),
      ...await validatePng(screenshot),
    });
    screenshotPaths.add(screenshot);
  }
  if (screenshots.length !== 315) {
    throw new Error(`Strict publish requires 315 screenshots; received ${screenshots.length}`);
  }
  if (screenshotPaths.size !== 315) {
    throw new Error(
      `Strict publish requires 315 unique screenshots; received ${screenshotPaths.size}`,
    );
  }
  const screenshotContentHashes = new Set(
    screenshots.map((screenshot) => screenshot.sha256),
  );
  if (screenshotContentHashes.size !== 315) {
    throw new Error(
      `Strict publish rejects duplicate screenshot content; received ${screenshotContentHashes.size} unique images for 315 cells`,
    );
  }
  await writeFile(resolve(root, "report.html"), html, "utf8");
  await writeFile(
    resolve(root, "artifact-validation.json"),
    JSON.stringify({
      validatedAt: new Date().toISOString(),
      screenshotCount: screenshots.length,
      uniqueScreenshotCount: screenshotPaths.size,
      uniqueScreenshotContentCount: screenshotContentHashes.size,
      brokenImages: 0,
      secretLeaks: 0,
      screenshots,
    }, null, 2),
    "utf8",
  );
  return { manifest, html, screenshots };
}

export async function validateHarnessFeatureMatrixArtifacts(stagingRoot) {
  return validateHarnessFeatureMatrixArtifactsWithReport(
    stagingRoot,
    generateHarnessFeatureMatrixReport,
  );
}

export async function validateHarnessFeatureMatrixDraftArtifacts(stagingRoot) {
  return validateHarnessFeatureMatrixArtifactsWithReport(
    stagingRoot,
    generateHarnessFeatureMatrixDraftReport,
  );
}

export async function publishHarnessFeatureMatrixReport(stagingRoot, publishedRoot) {
  const staging = resolve(stagingRoot);
  const published = resolve(publishedRoot);
  await validateHarnessFeatureMatrixArtifacts(staging);

  const parent = dirname(published);
  await mkdir(parent, { recursive: true });
  const candidate = await mkdtemp(resolve(parent, ".harness-feature-matrix-candidate-"));
  const backup = resolve(parent, `.harness-feature-matrix-backup-${process.pid}`);
  await cp(staging, candidate, { recursive: true, force: false });

  let movedPublished = false;
  try {
    try {
      await rename(published, backup);
      movedPublished = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(candidate, published);
    if (movedPublished) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedPublished) {
      try {
        await rename(backup, published);
      } catch {
        // Preserve the original error. The backup remains next to published
        // and is deliberately not deleted when restoration itself fails.
      }
    }
    throw error;
  }
}

async function main(argv) {
  if (argv[0] === "--validate-draft") {
    if (!argv[1] || argv.length !== 2) {
      throw new Error(
        "usage: publish-harness-feature-matrix-report.mjs --validate-draft <staging-dir>",
      );
    }
    await validateHarnessFeatureMatrixDraftArtifacts(argv[1]);
    return;
  }
  const staging = argv[0];
  const published = argv[1];
  if (!staging || !published) {
    throw new Error("usage: publish-harness-feature-matrix-report.mjs <staging-dir> <published-dir>");
  }
  await publishHarnessFeatureMatrixReport(staging, published);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
