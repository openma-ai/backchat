#!/usr/bin/env node
import { readdir, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import sharp from "sharp";

const root =
  process.env.PR56_ITEM_02_ROOT ??
  process.env.PR56_ACCEPTANCE_ROOT ??
  "/opt/cursor/artifacts/pr56-acceptance";
const beforeDir = join(root, "before");
const afterDir = join(root, "after");
const compareDir = join(root, "compare");
const leftLabel = process.env.PR56_COMPARE_LEFT_LABEL ?? "main";
const rightLabel = process.env.PR56_COMPARE_RIGHT_LABEL ?? "PR head";

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
    const colWidth = Math.max(beforeMeta.width ?? 0, afterMeta.width ?? 0);
    const height = Math.max(beforeMeta.height ?? 0, afterMeta.height ?? 0);
    const label = basename(file, ".png");
    const totalWidth = colWidth * 2;
    const split = colWidth;
    const fitColumn = async (inputPath) =>
      sharp({
        create: {
          width: colWidth,
          height,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite([
          {
            input: await sharp(inputPath)
              .resize({ width: colWidth, height, fit: "inside" })
              .toBuffer(),
            gravity: "northwest",
          },
        ])
        .png()
        .toBuffer();
    const beforeSize = `${beforeMeta.width ?? 0}×${beforeMeta.height ?? 0}`;
    const afterSize = `${afterMeta.width ?? 0}×${afterMeta.height ?? 0}`;
    const headerSvg = Buffer.from(
      `<svg width="${totalWidth}" height="40" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f4f4f5"/>
        <line x1="${split}" y1="0" x2="${split}" y2="40" stroke="#d4d4d8" stroke-width="1"/>
        <text x="${split / 2}" y="16" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" fill="#3f3f46">${leftLabel}</text>
        <text x="${split + colWidth / 2}" y="16" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" fill="#3f3f46">${rightLabel}</text>
        <text x="${split / 2}" y="32" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="#71717a">${beforeSize}px</text>
        <text x="${split + colWidth / 2}" y="32" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="#71717a">${afterSize}px</text>
      </svg>`,
    );
    const header = await sharp(headerSvg).png().toBuffer();
    const row = await sharp({
      create: {
        width: totalWidth,
        height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        {
          input: await fitColumn(beforePath),
          left: 0,
          top: 0,
        },
        {
          input: await fitColumn(afterPath),
          left: colWidth,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const out = join(compareDir, file.replace(/\.png$/, "-compare.png"));
    await sharp({
      create: {
        width: totalWidth,
        height: height + 40,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        { input: header, left: 0, top: 0 },
        { input: row, left: 0, top: 40 },
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
