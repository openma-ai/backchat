import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(projectRoot, "src/website/public");
const canonicalLogoUrl = import.meta.resolve("@openma/common/brand/openma-logo-mark.svg");
const canonicalLogoPath = fileURLToPath(canonicalLogoUrl);

const sourceSvg = await readFile(canonicalLogoPath, "utf8");
if (
  !sourceSvg.includes('viewBox="240 244 548 454"')
  || !sourceSvg.includes('<circle cx="535" cy="520" r="42"/>')
) {
  throw new Error("@openma/common no longer exposes the expected canonical OpenMA mark");
}

const websiteLogoSvg = sourceSvg
  .replace(
    "<!-- Canonical OpenMA mark, synchronized from openma-desktop. -->",
    "<!-- Generated from @openma/common/brand/openma-logo-mark.svg by pnpm website:brand. -->",
  )
  .replace(
    /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="240 244 548 454">/,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="240 244 548 454" role="img" aria-label="openma" fill="#f84f32">',
  );

if (!websiteLogoSvg.includes('role="img" aria-label="openma" fill="#f84f32"')) {
  throw new Error("Failed to prepare the canonical OpenMA mark for website use");
}

await writeFile(resolve(publicDir, "logo.svg"), websiteLogoSvg);

const markWidthRatio = 392 / 512;
const markHeightRatio = 325 / 512;

async function renderSquarePng(size) {
  const mark = await sharp(Buffer.from(websiteLogoSvg))
    .resize(Math.max(1, Math.round(size * markWidthRatio)), Math.max(1, Math.round(size * markHeightRatio)), {
      fit: "contain",
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toBuffer();
}

const pngTargets = [
  [16, "favicon-16.png"],
  [32, "favicon-32.png"],
  [180, "apple-touch-icon.png"],
  [192, "favicon-192.png"],
  [512, "favicon-512.png"],
];

const renderedPngs = new Map();
for (const [size, filename] of pngTargets) {
  const png = await renderSquarePng(size);
  renderedPngs.set(size, png);
  await writeFile(resolve(publicDir, filename), png);
}

function encodePngIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const directory = Buffer.alloc(headerSize + images.length * entrySize);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);

  let imageOffset = directory.length;
  images.forEach(({ size, png }, index) => {
    const entryOffset = headerSize + index * entrySize;
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(png.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += png.length;
  });

  return Buffer.concat([directory, ...images.map(({ png }) => png)]);
}

const icoImages = [];
for (const size of [16, 32, 48]) {
  icoImages.push({ size, png: renderedPngs.get(size) ?? await renderSquarePng(size) });
}
await writeFile(resolve(publicDir, "favicon.ico"), encodePngIco(icoImages));
