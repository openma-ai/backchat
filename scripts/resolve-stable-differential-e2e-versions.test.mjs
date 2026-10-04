import assert from "node:assert/strict";
import test from "node:test";
import { resolveLiveDifferentialProofVersions } from "./resolve-stable-differential-e2e-versions.mjs";

test("resolveLiveDifferentialProofVersions picks latest, previous stable, and seed tag", () => {
  const tags = ["v0.0.14", "v0.0.15", "v0.0.16"];
  const resolved = resolveLiveDifferentialProofVersions({
    latestTag: "v0.0.16",
    latestReleaseAssets: [
      "Backchat-0.0.16-arm64-mac.zip",
      "Backchat-0.0.15-arm64-mac.zip.blockmap",
      "latest-mac.yml",
    ],
    stableTags: tags,
  });
  assert.equal(resolved.toVersion, "0.0.16");
  assert.equal(resolved.builtStartVersion, "0.0.15");
  assert.equal(resolved.seedFromTag, "v0.0.14");
});

test("resolveLiveDifferentialProofVersions requires previous blockmap on latest release", () => {
  assert.throws(
    () =>
      resolveLiveDifferentialProofVersions({
        latestTag: "v0.0.17",
        latestReleaseAssets: ["Backchat-0.0.17-arm64-mac.zip", "latest-mac.yml"],
        stableTags: ["v0.0.15", "v0.0.16", "v0.0.17"],
      }),
    /Backchat-0\.0\.16-arm64-mac\.zip\.blockmap/,
  );
});
