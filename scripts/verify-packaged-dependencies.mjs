import { listPackage } from "@electron/asar";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const requiredPackages = [
  "ajv", "ajv-formats", "cors", "cross-spawn", "eventsource",
  "express", "express-rate-limit", "raw-body",
];

export async function verifyPackagedDependencies(archive) {
  const files = new Set(await listPackage(archive));
  const missing = requiredPackages.filter(name => !files.has(`/node_modules/${name}/package.json`));
  if (missing.length) throw new Error(`Packaged app is missing production dependencies: ${missing.join(", ")}`);
}

export default async function afterPack(context) {
  const app = context.electronPlatformName === "darwin"
    ? (await readdir(context.appOutDir)).find(name => name.endsWith(".app"))
    : null;
  if (context.electronPlatformName === "darwin" && !app) throw new Error("Packaged macOS app not found");
  const archive = app
    ? join(context.appOutDir, app, "Contents", "Resources", "app.asar")
    : join(context.appOutDir, "resources", "app.asar");
  await verifyPackagedDependencies(archive);
}
