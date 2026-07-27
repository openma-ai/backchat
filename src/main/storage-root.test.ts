import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migrateLegacyOpenmaRoot, openmaRoot } from "./storage-root";

const temporaryHomes: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryHomes.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Backchat storage root", () => {
  it("uses the OMA home for normal launches", () => {
    expect(openmaRoot()).toBe(join(homedir(), ".oma"));
  });

  it("merges legacy Backchat data into an existing OMA home without overwriting it", async () => {
    const home = await mkdtemp(join(tmpdir(), "backchat-storage-root-"));
    temporaryHomes.push(home);
    const legacyRoot = join(home, ".openma");
    const omaRoot = join(home, ".oma");

    await mkdir(join(legacyRoot, "sessions"), { recursive: true });
    await mkdir(join(omaRoot, "bridge"), { recursive: true });
    await writeFile(join(legacyRoot, "config.toml"), "legacy = true\n");
    await writeFile(join(legacyRoot, "sessions", "history.jsonl"), "history\n");
    await writeFile(join(omaRoot, "bridge", "credentials.json"), "credentials\n");

    await migrateLegacyOpenmaRoot(home);

    await expect(readFile(join(omaRoot, "config.toml"), "utf8")).resolves.toBe(
      "legacy = true\n",
    );
    await expect(
      readFile(join(omaRoot, "sessions", "history.jsonl"), "utf8"),
    ).resolves.toBe("history\n");
    await expect(
      readFile(join(omaRoot, "bridge", "credentials.json"), "utf8"),
    ).resolves.toBe("credentials\n");
  });

  it("preserves both files when legacy and OMA homes contain the same path", async () => {
    const home = await mkdtemp(join(tmpdir(), "backchat-storage-root-"));
    temporaryHomes.push(home);
    const legacyRoot = join(home, ".openma");
    const omaRoot = join(home, ".oma");

    await mkdir(legacyRoot, { recursive: true });
    await mkdir(omaRoot, { recursive: true });
    await writeFile(join(legacyRoot, "config.toml"), "legacy = true\n");
    await writeFile(join(omaRoot, "config.toml"), "oma = true\n");

    await migrateLegacyOpenmaRoot(home);

    await expect(readFile(join(omaRoot, "config.toml"), "utf8")).resolves.toBe(
      "oma = true\n",
    );
    await expect(
      readFile(
        join(omaRoot, ".backchat-migration", "openma-root-v1", "config.toml"),
        "utf8",
      ),
    ).resolves.toBe("legacy = true\n");
  });
});
