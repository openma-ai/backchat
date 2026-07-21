import { basename } from "node:path";

import { createBrowserExtensionPackage } from "../packages/browser-extension/src/package.js";

async function main(): Promise<void> {
  const result = await createBrowserExtensionPackage();
  console.log(`Wrote ${basename(result.zipPath)}`);
  console.log(`Wrote ${basename(result.installManifestPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
