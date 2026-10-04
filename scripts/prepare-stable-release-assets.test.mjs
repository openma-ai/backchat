import assert from "node:assert/strict";
import test from "node:test";
import {
  compareStableVersions,
  macZipBlockmapName,
  previousStableVersion,
} from "./prepare-stable-release-assets.mjs";

test("finds the previous stable semver", () => {
  const tags = ["v0.0.12", "v0.0.13", "v0.0.14", "v0.0.15", "v0.0.16"];
  assert.equal(previousStableVersion("0.0.15", tags), "0.0.14");
  assert.equal(previousStableVersion("0.0.12", tags), null);
  assert.equal(macZipBlockmapName("0.0.14"), "Backchat-0.0.14-arm64-mac.zip.blockmap");
});

test("orders stable versions numerically", () => {
  assert.ok(compareStableVersions("0.0.10", "0.0.9") > 0);
  assert.ok(compareStableVersions("0.1.0", "0.0.99") > 0);
});
