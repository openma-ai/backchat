import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyMacPackaging, packagedVersion, signingPlan } from "./configure-mac-packaging.mjs";

const complete = {
  MAC_CSC_LINK: "cGlj",
  MAC_CSC_KEY_PASSWORD: "secret",
  APPLE_API_KEY_BASE64: "a2V5",
  APPLE_API_KEY_ID: "KEYID",
  APPLE_API_ISSUER: "issuer",
  APPLE_TEAM_ID: "TEAMID",
};

test("missing signing secrets fall back to ad-hoc without naming a team", () => {
  const plan = signingPlan({});
  assert.equal(plan.mode, "adhoc");
  assert.ok(plan.missing.includes("Team ID"));
  assert.ok(plan.missing.includes("CSC link"));
  const pkg = applyMacPackaging({
    version: "0.0.12",
    build: { mac: { identity: "-", hardenedRuntime: false, target: ["dmg", "zip"] } },
  }, plan);
  assert.equal(pkg.build.mac.identity, "-");
  assert.equal(pkg.build.mac.hardenedRuntime, false);
  assert.equal(pkg.build.mac.notarize, false);
  assert.equal(JSON.stringify(pkg).includes("TEAMID"), false);
});

test("a complete secret set enables hardened runtime and notarization without embedding the team id", async () => {
  const plan = signingPlan(complete);
  assert.equal(plan.mode, "developer-id");
  assert.deepEqual(plan.missing, []);
  const pkg = applyMacPackaging({
    version: "0.0.12",
    build: { mac: { identity: "-", hardenedRuntime: false, target: ["dmg", "zip"] } },
  }, plan);
  assert.equal(pkg.build.mac.identity, undefined);
  assert.equal(pkg.build.mac.hardenedRuntime, true);
  assert.equal(pkg.build.mac.notarize, true);
  assert.equal(pkg.build.mac.entitlements, "build/entitlements.mac.plist");
  assert.equal(pkg.build.mac.entitlementsInherit, "build/entitlements.mac.plist");
  assert.equal(JSON.stringify(pkg).includes("TEAMID"), false);
  const entitlements = await readFile(new URL("../build/entitlements.mac.plist", import.meta.url), "utf8");
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.doesNotMatch(entitlements, /TEAMID|Developer ID Application/);
});

test("one missing secret keeps the ad-hoc fallback", () => {
  const plan = signingPlan({ ...complete, APPLE_TEAM_ID: "  " });
  assert.equal(plan.mode, "adhoc");
  assert.deepEqual(plan.missing, ["Team ID"]);
});

test("preview builds get a monotonic prerelease version and stable builds do not", () => {
  assert.equal(packagedVersion("0.0.12", "preview", 42001), "0.0.12-preview.42001");
  assert.equal(packagedVersion("0.0.12", "stable", 42001), "0.0.12");
  assert.equal(packagedVersion("0.0.12", "preview", 0), "0.0.12");
});
