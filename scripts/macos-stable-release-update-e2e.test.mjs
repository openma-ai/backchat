import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeUpdaterDownload,
  assertDifferentialUpdate,
  parseFromTag,
  parseRequireDifferential,
  parseStableUpdateConfig,
  parseToVersion,
  releaseDownloadFeedUrl,
} from "./macos-stable-release-update-e2e.mjs";

test("parses stable release tags and target versions", () => {
  assert.equal(parseFromTag("v0.0.13"), "v0.0.13");
  assert.equal(parseToVersion("0.0.14"), "0.0.14");
  assert.equal(parseToVersion(""), "");
  assert.throws(() => parseFromTag("0.0.13"));
  assert.throws(() => parseToVersion("v0.0.14"));
});

test("builds two-hop config with pinned via feed", () => {
  const config = parseStableUpdateConfig({
    BACKCHAT_STABLE_FROM_TAG: "v0.0.13",
    BACKCHAT_STABLE_VIA_VERSION: "0.0.14",
    BACKCHAT_STABLE_TO_VERSION: "0.0.15",
    BACKCHAT_STABLE_REQUIRE_DIFFERENTIAL: "true",
    GITHUB_REPOSITORY: "openma-ai/backchat",
  });
  assert.equal(config.twoHop, true);
  assert.equal(config.hop1FeedUrl, releaseDownloadFeedUrl("v0.0.14"));
  assert.equal(config.requireDifferential, true);
});

test("single-hop config uses GitHub latest feed", () => {
  const config = parseStableUpdateConfig({
    BACKCHAT_STABLE_FROM_TAG: "v0.0.13",
    BACKCHAT_STABLE_VIA_VERSION: "0.0.14",
    BACKCHAT_STABLE_TO_VERSION: "",
  });
  assert.equal(config.twoHop, false);
  assert.equal(config.hop1FeedUrl, "");
  assert.equal(config.hop1Target, "0.0.14");
});

test("require_differential parses truthy values", () => {
  assert.equal(parseRequireDifferential("true"), true);
  assert.equal(parseRequireDifferential("1"), true);
  assert.equal(parseRequireDifferential("false"), false);
});

test("assertDifferentialUpdate rejects full fallback", () => {
  const log = [
    "[updater] Download block maps",
    "[updater] Unable to locate previous update.zip for differential download, falling back to full download",
  ].join("\n");
  const result = assertDifferentialUpdate(log, 200_000_000);
  assert.ok(result.errors.some((error) => error.includes("full download")));
  assert.equal(analyzeUpdaterDownload(log).fullFallback, true);
});

test("assertDifferentialUpdate accepts blockmap segment without full fallback", () => {
  const log = [
    "[updater] Download block maps",
    "[updater] Differential download: 1234567 / 200000000",
  ].join("\n");
  const result = assertDifferentialUpdate(log, 200_000_000);
  assert.deepEqual(result.errors, []);
  assert.equal(result.analysis.downloadedBytes, 1_234_567);
});
