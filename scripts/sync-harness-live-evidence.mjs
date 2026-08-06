#!/usr/bin/env node

import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  generateHarnessFeatureMatrixDraftReport,
} from "./generate-harness-feature-matrix-report.mjs";

const SECRET_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/;

export async function syncHarnessLiveEvidence(rootPath) {
  const root = resolve(rootPath);
  const manifestPath = resolve(root, "manifest.json");
  const liveRoot = resolve(root, "live-gui");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const evidenceByHarness = new Map();

  for (const filename of await readdir(liveRoot)) {
    if (!filename.endsWith("-final-response.json")) continue;
    const text = await readFile(resolve(liveRoot, filename), "utf8");
    if (SECRET_PATTERN.test(text)) {
      throw new Error(`Secret-shaped material found in ${filename}`);
    }
    const evidence = JSON.parse(text);
    if (
      evidence?.feature === "output.final-response"
      && typeof evidence?.harness === "string"
    ) {
      evidenceByHarness.set(evidence.harness, evidence);
    }
  }

  const missing = manifest.harnesses.filter(
    (harness) => !evidenceByHarness.has(harness),
  );
  if (missing.length > 0) {
    throw new Error(`Missing live final-response evidence: ${missing.join(", ")}`);
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.cells = manifest.cells.map((cell) => (
    cell.feature === "output.final-response"
      ? evidenceByHarness.get(cell.harness)
      : cell
  ));
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (SECRET_PATTERN.test(manifestText)) {
    throw new Error("Secret-shaped material found in refreshed manifest");
  }
  const report = generateHarnessFeatureMatrixDraftReport(manifest);
  const manifestTmp = `${manifestPath}.${process.pid}.tmp`;
  const reportPath = resolve(root, "report.html");
  const reportTmp = `${reportPath}.${process.pid}.tmp`;
  await writeFile(manifestTmp, manifestText, "utf8");
  await writeFile(reportTmp, report, "utf8");
  await rename(manifestTmp, manifestPath);
  await rename(reportTmp, reportPath);
  return manifest;
}

async function main(argv) {
  const root = argv[0];
  if (!root) {
    throw new Error("usage: sync-harness-live-evidence.mjs <matrix-root>");
  }
  await syncHarnessLiveEvidence(root);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
