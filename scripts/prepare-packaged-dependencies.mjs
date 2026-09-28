import { cp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// electron-builder's pnpm dependency walker currently omits these production
// packages when it encounters duplicate references. Stage their complete
// runtime dependency trees as real directories for an explicit ASAR FileSet.
const roots = [
  "ajv", "ajv-formats", "cors", "cross-spawn", "eventsource",
  "express", "express-rate-limit", "raw-body",
];

export default async function preparePackagedDependencies() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const stagingRoot = join(projectRoot, "build", "packaged-dependencies");
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(join(stagingRoot, "node_modules"), { recursive: true });
  const rootVersions = new Map();
  const copied = new Set();

  async function copyDependency(name, sourceBase, parentTarget) {
    const source = await realpath(join(sourceBase, "node_modules", name));
    const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    const version = manifest.version;
    const rootVersion = rootVersions.get(name);
    const destinationBase = rootVersion && rootVersion !== version ? parentTarget : stagingRoot;
    if (!rootVersion) rootVersions.set(name, version);
    const target = join(destinationBase, "node_modules", name);
    if (copied.has(target)) return;
    copied.add(target);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, dereference: true });

    const dependencySourceBase = dirname(dirname(source));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      await copyDependency(dependency, dependencySourceBase, target);
    }
  }

  for (const root of roots) await copyDependency(root, projectRoot, stagingRoot);
}
