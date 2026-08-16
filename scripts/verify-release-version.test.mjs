import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const verifier = resolve(scriptsDir, "verify-release-version.mjs");

test("only accepts a release tag matching the packaged app version", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-release-version-"));
  const packagePath = resolve(root, "package.json");
  await writeFile(packagePath, JSON.stringify({ version: "0.0.3" }), "utf8");

  try {
    const mismatch = spawnSync(process.execPath, [verifier, packagePath], {
      env: { ...process.env, GITHUB_REF_NAME: "v0.0.4" },
      encoding: "utf8",
    });
    assert.notEqual(mismatch.status, 0);
    assert.match(
      mismatch.stderr,
      /release tag v0\.0\.4 does not match package version v0\.0\.3/,
    );

    const matching = spawnSync(process.execPath, [verifier, packagePath], {
      env: { ...process.env, GITHUB_REF_NAME: "v0.0.3" },
      encoding: "utf8",
    });
    assert.equal(matching.status, 0, matching.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
