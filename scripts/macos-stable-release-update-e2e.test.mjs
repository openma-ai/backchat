import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertDifferentialUpdate,
  differentialFailureReasons,
  parseDifferentialDownloadBytes,
  parseFromTag,
  parseHumanDataSize,
  parseRequireDifferential,
  parseStableUpdateConfig,
  parseToVersion,
  releaseDownloadFeedUrl,
} from "./macos-stable-release-update-e2e.mjs";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const hop2Fixture = readFileSync(join(fixtureDir, "stable-hop2-full-download-updater.fixture"), "utf8");

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

test("require_differential parses truthy values", () => {
  assert.equal(parseRequireDifferential("true"), true);
  assert.equal(parseRequireDifferential("1"), true);
  assert.equal(parseRequireDifferential("false"), false);
});

test("parseHumanDataSize understands electron-updater KB formatting", () => {
  assert.equal(parseHumanDataSize("12,615.63 KB"), Math.round(12615.63 * 1024));
});

test("parseDifferentialDownloadBytes reads DifferentialDownloader plan line", () => {
  const fullPackageBytes = 181_133_316;
  const log = [
    "[updater] Download block maps (old: \"...0.0.14....blockmap\", new: ...)",
    "[updater] Full: 176,888.98 KB, To download: 12,615.63 KB (7%)",
  ].join("\n");
  const bytes = parseDifferentialDownloadBytes(log, fullPackageBytes);
  assert.equal(bytes, Math.round(fullPackageBytes * 0.07));
});

test("detects differential failure phrases from the real hop2 fixture", () => {
  const reasons = differentialFailureReasons(hop2Fixture);
  assert.ok(reasons.includes("Cannot download differentially"));
  assert.ok(reasons.includes("fallback to full download"));
});

test("assertDifferentialUpdate fails on real full-download fixture", () => {
  const fullPackageBytes = 181_133_316;
  const result = assertDifferentialUpdate(hop2Fixture, fullPackageBytes);
  assert.ok(result.errors.some((error) => error.includes("Cannot download differentially")));
  assert.ok(result.errors.some((error) => error.includes("fallback to full download")));
  assert.ok(
    result.errors.some((error) => error.includes("could not determine differential download bytes")),
  );
});

test("assertDifferentialUpdate passes on differential plan without fallback", () => {
  const fullPackageBytes = 181_133_316;
  const log = [
    "[updater] Differential download: https://github.com/openma-ai/backchat/releases/latest/download/Backchat-0.0.16-arm64-mac.zip",
    "[updater] Full: 176,888.98 KB, To download: 12,615.63 KB (7%)",
  ].join("\n");
  const result = assertDifferentialUpdate(log, fullPackageBytes);
  assert.deepEqual(result.errors, []);
  assert.ok(result.analysis.downloadedBytes < fullPackageBytes * 0.9);
});

test("assertDifferentialUpdate fails when differential download bytes are unknown", () => {
  const log = "[updater] Download block maps\n";
  const result = assertDifferentialUpdate(log, 1_000_000);
  assert.ok(result.errors.some((error) => error.includes("could not determine differential download bytes")));
});
