/**
 * Decides ad-hoc vs Developer ID packaging from CI secrets.
 * The Team ID is only read from the environment and never written into the repo.
 */

const REQUIRED_SIGNING_INPUTS = [
  ["CSC link", "MAC_CSC_LINK", "CSC_LINK"],
  ["CSC password", "MAC_CSC_KEY_PASSWORD", "CSC_KEY_PASSWORD"],
  ["API key", "APPLE_API_KEY_BASE64", "APPLE_API_KEY"],
  ["API key id", "APPLE_API_KEY_ID"],
  ["API issuer", "APPLE_API_ISSUER"],
  ["Team ID", "APPLE_TEAM_ID"],
];

export function firstEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function signingPlan(env) {
  const missing = [];
  for (const [label, ...names] of REQUIRED_SIGNING_INPUTS) {
    if (!firstEnv(env, names)) missing.push(label);
  }
  return {
    mode: missing.length === 0 ? "developer-id" : "adhoc",
    missing,
  };
}

export function applyMacPackaging(pkg, plan) {
  const next = structuredClone(pkg);
  next.build ??= {};
  next.build.mac ??= {};
  if (plan.mode === "developer-id") {
    delete next.build.mac.identity;
    next.build.mac.hardenedRuntime = true;
    next.build.mac.gatekeeperAssess = false;
    next.build.mac.notarize = true;
    next.build.mac.entitlements = "build/entitlements.mac.plist";
    next.build.mac.entitlementsInherit = "build/entitlements.mac.plist";
  } else {
    next.build.mac.identity = "-";
    next.build.mac.hardenedRuntime = false;
    next.build.mac.notarize = false;
    delete next.build.mac.entitlements;
    delete next.build.mac.entitlementsInherit;
    delete next.build.mac.gatekeeperAssess;
  }
  next.publish = {
    provider: "github",
    owner: "openma-ai",
    repo: "backchat",
  };
  return next;
}

export function packagedVersion(baseVersion, channel, build) {
  if (channel !== "preview" || !Number.isSafeInteger(build) || build <= 0) return baseVersion;
  if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
    throw new Error(`Preview packaging requires package.json version x.y.z, got ${baseVersion}`);
  }
  return `${baseVersion}-preview.${build}`;
}
