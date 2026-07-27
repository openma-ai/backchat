import { lstat, mkdir, readdir, rename, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Root shared by Backchat and OMA. BACKCHAT_HOME remains test-only so E2E
 *  processes cannot read or mutate the developer's real local state. */
export function openmaRoot(): string {
  const testHome = process.env["BACKCHAT_HOME"];
  if (process.env["BACKCHAT_TEST_HOOKS"] === "1" && testHome) {
    return testHome;
  }
  return join(homedir(), ".oma");
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function moveToAvailablePath(
  source: string,
  destination: string,
): Promise<void> {
  let candidate = destination;
  let suffix = 1;
  while (await pathExists(candidate)) {
    candidate = `${destination}.${suffix}`;
    suffix += 1;
  }
  await mkdir(dirname(candidate), { recursive: true });
  await rename(source, candidate);
}

async function mergeDirectory(
  source: string,
  destination: string,
  conflictRoot: string,
  relativePath = "",
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceEntry = join(source, entry.name);
    const destinationEntry = join(destination, entry.name);
    const entryRelativePath = join(relativePath, entry.name);

    if (!(await pathExists(destinationEntry))) {
      await rename(sourceEntry, destinationEntry);
      continue;
    }

    const destinationStat = await lstat(destinationEntry);
    if (entry.isDirectory() && destinationStat.isDirectory()) {
      await mergeDirectory(
        sourceEntry,
        destinationEntry,
        conflictRoot,
        entryRelativePath,
      );
      continue;
    }

    await moveToAvailablePath(sourceEntry, join(conflictRoot, entryRelativePath));
  }
  await rmdir(source);
}

/** Move pre-OMA Backchat state into the shared OMA root before any store opens.
 *  The common case is one atomic directory rename. If OMA already created its
 *  root (for example for bridge credentials), merge without overwriting it and
 *  retain conflicting legacy files under a deterministic backup directory. */
export async function migrateLegacyOpenmaRoot(home = homedir()): Promise<void> {
  if (
    home === homedir() &&
    process.env["BACKCHAT_TEST_HOOKS"] === "1" &&
    process.env["BACKCHAT_HOME"]
  ) {
    return;
  }

  const legacyRoot = join(home, ".openma");
  const destinationRoot = join(home, ".oma");
  if (!(await pathExists(legacyRoot))) return;

  if (!(await pathExists(destinationRoot))) {
    await rename(legacyRoot, destinationRoot);
    return;
  }

  await mergeDirectory(
    legacyRoot,
    destinationRoot,
    join(destinationRoot, ".backchat-migration", "openma-root-v1"),
  );
}
