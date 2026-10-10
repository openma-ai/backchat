#!/usr/bin/env node
import { readdir, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import sharp from "sharp";

const root =
  process.env.PR56_ACCEPTANCE_ROOT ?? "/opt/cursor/artifacts/pr56-acceptance";
const beforeDir = join(root, "before");
const afterDir = join(root, "after");
const compareDir = join(root, "compare");

async function main() {
  await mkdir(compareDir, { recursive: true });
  const beforeFiles = (await readdir(beforeDir)).filter((f) => f.endsWith(".png"));
  let count = 0;
  for (const file of beforeFiles) {
    const beforePath = join(beforeDir, file);
    const afterPath = join(afterDir, file);
    try {
      await sharp(afterPath).metadata();
    } catch {
      continue;
    }
    const before = sharp(beforePath);
    const after = sharp(afterPath);
    const beforeMeta = await before.metadata();
    const afterMeta = await after.metadata();
    const height = Math.max(beforeMeta.height ?? 0, afterMeta.height ?? 0);
    const label = basename(file, ".png");
    const header = await sharp({
      create: {
        width: (beforeMeta.width ?? 0) + (afterMeta.width ?? 0),
        height: 28,
        channels: 4,
        background: { r: 248, g: 248, b: 248, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const row = await sharp({
      create: {
        width: (beforeMeta.width ?? 0) + (afterMeta.width ?? 0),
        height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        {
          input: await before.resize({ height }).toBuffer(),
          left: 0,
          top: 0,
        },
        {
          input: await after.resize({ height }).toBuffer(),
          left: beforeMeta.width ?? 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const out = join(compareDir, file.replace(/\.png$/, "-compare.png"));
    await sharp({
      create: {
        width: (beforeMeta.width ?? 0) + (afterMeta.width ?? 0),
        height: height + 28,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        { input: header, left: 0, top: 0 },
        { input: row, left: 0, top: 28 },
      ])
      .png()
      .toFile(out);
    count += 1;
    console.log(`compare: ${label}`);
  }
  console.log(`Wrote ${count} compare images to ${compareDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
