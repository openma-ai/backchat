#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const appBundle = process.argv[2];

if (!appBundle) {
  console.error("Usage: node scripts/verify-packaged-macos-signature.mjs <app-bundle>");
  process.exit(2);
}

if (process.platform !== "darwin") {
  console.error("Packaged macOS signature verification requires macOS");
  process.exit(2);
}

const result = spawnSync(
  "/usr/bin/codesign",
  ["--verify", "--deep", "--strict", "--verbose=4", resolve(appBundle)],
  { encoding: "utf8" },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;

process.exit(result.status ?? 1);
