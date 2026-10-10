#!/usr/bin/env node
/**
 * Print PR comment markdown for checklist evidence PNGs.
 * Images live only under /opt/cursor/artifacts (never commit PNGs / pr-assets).
 *
 * Post via ManagePullRequest with <img src="/opt/cursor/artifacts/..."/> tags.
 * Cursor rewrites those to public CDN URLs only when:
 *   - Cloud Agents → My pull requests → "Allow posting artifacts to GitHub" is on, and
 *   - the write is the PR description (body) via ManagePullRequest update_pr/create_pr.
 * PR comments currently get agent viewer links, not inline CDN images.
 *
 * After a body update with inline images enabled, copy the rewritten https://… URLs
 * into a follow-up comment if you need evidence in a comment thread.
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
