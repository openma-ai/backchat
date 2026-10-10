#!/usr/bin/env node
/**
 * Print PR comment markdown for checklist evidence PNGs.
 * Images live only under /opt/cursor/artifacts (never commit PNGs / pr-assets).
 *
 * Post via ManagePullRequest post_comment using markdown image syntax:
 *   ![label](/opt/cursor/artifacts/…/file.png)
 * Cursor should rewrite those paths to public cursor.com-hosted image URLs for GitHub.
 * Requires Cloud Agents → My pull requests → “Allow posting artifacts to GitHub”.
 * After posting, verify each URL with: curl -sI -L '<url>' → content-type: image/png
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
  console.log("# Paste into PR comment via ManagePullRequest post_comment (not committed to repo)\n");
  for (const file of files) {
    const abs = join(compareDir, file);
    const label = file.replace(/-/g, " ").replace(/\.png$/, "");
    console.log(`![${label}](${abs})\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
