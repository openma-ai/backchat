import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const publisher = resolve(scriptsDir, "publish-preview-release.mjs");

async function makeFixture({ releaseExists = false } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-preview-release-"));
  const releaseDir = resolve(root, "release", "0.1.0");
  const binDir = resolve(root, "bin");
  const ghLog = resolve(root, "gh.log");
  await mkdir(releaseDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(resolve(releaseDir, "Backchat-0.1.0-arm64.dmg"), "dmg bytes");

  const fakeGh = resolve(binDir, "gh");
  await writeFile(
    fakeGh,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.GH_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "release" && process.argv[3] === "view") {
  process.exit(process.env.FAKE_RELEASE_EXISTS === "1" ? 0 : 1);
}
`,
    "utf8",
  );
  await chmod(fakeGh, 0o755);

  return {
    root,
    releaseRoot: resolve(root, "release"),
    ghLog,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GH_LOG: ghLog,
      FAKE_RELEASE_EXISTS: releaseExists ? "1" : "0",
    },
  };
}

test("creates the stable preview release and asset when it does not exist", async () => {
  const fixture = await makeFixture();
  try {
    const result = spawnSync(process.execPath, [publisher, fixture.releaseRoot], {
      env: fixture.env,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      await readFile(resolve(fixture.releaseRoot, "Backchat-preview-arm64.dmg"), "utf8"),
      "dmg bytes",
    );
    const calls = (await readFile(fixture.ghLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(calls[0], ["release", "view", "preview"]);
    assert.deepEqual(calls[1], [
      "release",
      "create",
      "preview",
      resolve(fixture.releaseRoot, "Backchat-preview-arm64.dmg"),
      "--prerelease",
      "--title",
      "Backchat Preview",
      "--notes",
      "Latest successful build from the main branch.",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("replaces the stable asset when the preview release already exists", async () => {
  const fixture = await makeFixture({ releaseExists: true });
  try {
    const result = spawnSync(process.execPath, [publisher, fixture.releaseRoot], {
      env: fixture.env,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const previewAsset = resolve(fixture.releaseRoot, "Backchat-preview-arm64.dmg");
    assert.equal(await readFile(previewAsset, "utf8"), "dmg bytes");
    const calls = (await readFile(fixture.ghLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(calls, [
      ["release", "view", "preview"],
      ["release", "upload", "preview", previewAsset, "--clobber"],
      [
        "release",
        "edit",
        "preview",
        "--prerelease",
        "--title",
        "Backchat Preview",
        "--notes",
        "Latest successful build from the main branch.",
      ],
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
