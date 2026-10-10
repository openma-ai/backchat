#!/usr/bin/env node
/**
 * Print PR comment markdown for checklist evidence PNGs.
 * Images live only under /opt/cursor/artifacts — post the output via
 * ManagePullRequest post_comment with <img src="/opt/cursor/artifacts/..."/>
 * so Cursor uploads them for GitHub inline display (no git commits).
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const itemId = process.argv[2];
if (!itemId) {
  console.error("usage: node scripts/publish-pr56-item-inline.mjs <item-dir-name>");
  process.exit(1);
}

const compareDir = join("/opt/cursor/artifacts", itemId, "compare");

async function main() {
  const files = (await readdir(compareDir))
    .filter((f) => f.endsWith(".png"))
    .sort();
  if (!files.length) {
    console.error(`no PNGs in ${compareDir}`);
    process.exit(1);
  }
  console.log("# Paste into PR comment (artifact paths — not committed to repo)\n");
  for (const file of files) {
    const abs = join(compareDir, file);
    console.log(`<img alt="${file.replace(/-/g, " ")}" src="${abs}" />\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
