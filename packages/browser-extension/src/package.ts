import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(dirname(here)));
const defaultExtensionDir = join(repoRoot, "packages/browser-extension");
const defaultOutputDir = join(repoRoot, "dist/browser-extension");

const fixedPackageFiles = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
];

export interface BrowserExtensionPackageOptions {
  extensionDir?: string;
  outputDir?: string;
  generatedAt?: string;
}

export interface BrowserExtensionPackageResult {
  zipPath: string;
  installManifestPath: string;
  files: string[];
}

interface ChromeExtensionManifest {
  manifest_version?: unknown;
  name?: unknown;
  version?: unknown;
  background?: { service_worker?: unknown };
  action?: { default_popup?: unknown };
}

export async function createBrowserExtensionPackage(
  options: BrowserExtensionPackageOptions = {},
): Promise<BrowserExtensionPackageResult> {
  const extensionDir = options.extensionDir ?? defaultExtensionDir;
  const outputDir = options.outputDir ?? defaultOutputDir;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const manifest = await readManifest(extensionDir);
  const files = packageFilesForManifest(manifest);
  const entries = await Promise.all(files.map(async (path) => ({
    path,
    bytes: await readFile(join(extensionDir, path)),
  })));
  const version = readManifestString(manifest.version, "manifest.version");
  const name = readManifestString(manifest.name, "manifest.name");
  const zipName = `backchat-browser-extension-${version}.zip`;
  const zipPath = join(outputDir, zipName);
  const installManifestPath = join(outputDir, "browser-extension-install.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(zipPath, createStoredZip(entries, new Date(generatedAt)));
  await writeFile(
    installManifestPath,
    `${JSON.stringify({
      generatedAt,
      installMode: "chrome-extension-zip",
      extensionName: name,
      extensionVersion: version,
      packageFile: zipName,
      sourceDirectory: extensionDir,
      files,
      installSteps: [
        "Open chrome://extensions",
        "Enable Developer mode",
        "Drag the zip into Chrome or unzip it and Load unpacked from the extracted directory",
        "Open Backchat Settings > Browser and confirm the bridge status is connected",
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  return { zipPath, installManifestPath, files };
}

export function listStoredZipEntries(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid zip central directory entry");
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readManifest(extensionDir: string): Promise<ChromeExtensionManifest> {
  const manifest = JSON.parse(await readFile(join(extensionDir, "manifest.json"), "utf8")) as ChromeExtensionManifest;
  if (manifest.manifest_version !== 3) {
    throw new Error("Browser extension package requires Manifest V3");
  }
  return manifest;
}

function packageFilesForManifest(manifest: ChromeExtensionManifest): string[] {
  const files = [
    "manifest.json",
    readManifestString(manifest.background?.service_worker, "manifest.background.service_worker"),
    readManifestString(manifest.action?.default_popup, "manifest.action.default_popup"),
    ...fixedPackageFiles.slice(3),
  ];
  return [...new Set(files)].map((file) => {
    if (file.includes("/") || file.includes("\\") || file === "." || file === "..") {
      throw new Error(`Browser extension package file must be in the extension root: ${file}`);
    }
    return file;
  });
}

function readManifestString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Browser extension package requires ${path}`);
  }
  return value;
}

function createStoredZip(
  entries: Array<{ path: string; bytes: Uint8Array }>,
  date: Date,
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const modTime = dosTime(date);
  const modDate = dosDate(date);

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const data = Buffer.from(entry.bytes);
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(modTime, 10);
    localHeader.writeUInt16LE(modDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.byteLength, 18);
    localHeader.writeUInt32LE(data.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(modTime, 12);
    centralHeader.writeUInt16LE(modDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.byteLength, 20);
    centralHeader.writeUInt32LE(data.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.byteLength + name.byteLength + data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  for (let offset = buffer.byteLength - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid zip: end of central directory not found");
}

function dosTime(date: Date): number {
  return date.getHours() << 11 | date.getMinutes() << 5 | Math.floor(date.getSeconds() / 2);
}

function dosDate(date: Date): number {
  const year = Math.max(1980, date.getFullYear());
  return (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
