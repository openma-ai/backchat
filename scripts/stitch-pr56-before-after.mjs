#!/usr/bin/env node
/**
 * Stitch matching PNGs from pr56-acceptance/before and after into compare/*.png
 */
import { readdir, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root =
  process.env.PR56_ACCEPTANCE_ROOT ?? "/opt/cursor/artifacts/pr56-acceptance";
const beforeDir = join(root, "before");
const afterDir = join(root, "after");
const compareDir = join(root, "compare");

async function magick(args) {
  try {
    await exec("magick", args);
    return;
  } catch {
    await exec("convert", args);
  }
}

async function main() {
  await mkdir(compareDir, { recursive: true });
  const beforeFiles = (await readdir(beforeDir)).filter((f) => f.endsWith(".png"));
  for (const file of beforeFiles) {
    const before = join(beforeDir, file);
    const after = join(afterDir, file);
    const out = join(compareDir, file.replace(/\.png$/, "-compare.png"));
    const label = basename(file, ".png");
    await magick([
      before,
      after,
      "+append",
      "-gravity",
      "north",
      "-splice",
      "0x28",
      "-fill",
      "black",
      "-pointsize",
      "14",
      "-annotate",
      "+20+8",
      `Before (main) | After (PR) — ${label}`,
      out,
    ]);
  }
  console.log(`Wrote ${beforeFiles.length} compare images to ${compareDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
