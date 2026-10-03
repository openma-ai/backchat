#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const appBundle = process.argv[2];

export function classifySignature(details) {
  const developerId = /Authority=Developer ID Application:/.test(details);
  const adhoc = /Signature=adhoc/.test(details) || /flags=[^\n]*\badhoc\b/.test(details);
  const hardenedRuntime = /flags=[^\n]*\bruntime\b/.test(details);
  const stapled = /Notarization Ticket=stapled/.test(details);
  if (developerId) return { kind: "developer-id", hardenedRuntime, stapled };
  if (adhoc) return { kind: "adhoc", hardenedRuntime, stapled };
  return { kind: "unknown", hardenedRuntime, stapled };
}

export function signatureRequirementErrors(classification, options) {
  if (classification.kind === "unknown") return ["unrecognized macOS signature"];
  if (classification.kind === "adhoc") {
    const errors = [];
    if (options.requireDeveloperId) {
      errors.push("expected a Developer ID Application signature, found an ad-hoc signature");
    }
    if (classification.hardenedRuntime) {
      errors.push("ad-hoc fallback must keep hardened runtime off");
    }
    return errors;
  }
  const errors = [];
  if (!classification.hardenedRuntime) {
    errors.push("Developer ID signature is missing the hardened runtime flag");
  }
  if (!classification.stapled && !options.notarizationAccepted) {
    errors.push("Developer ID app is not notarized");
  }
  return errors;
}

export function entitlementErrors(entitlements) {
  const required = [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-library-validation",
  ];
  return required
    .filter((key) => !entitlements.includes(key))
    .map((key) => `hardened runtime entitlements are missing ${key}`);
}

async function findNativeAddons(directory) {
  const matches = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await findNativeAddons(path));
    else if (entry.isFile() && entry.name.endsWith(".node")) matches.push(path);
  }
  return matches;
}

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

async function main() {
  if (!appBundle) {
    console.error("Usage: node scripts/verify-packaged-macos-signature.mjs <app-bundle>");
    process.exitCode = 2;
    return;
  }
  if (process.platform !== "darwin") {
    console.error("Packaged macOS signature verification requires macOS");
    process.exitCode = 2;
    return;
  }

  const bundle = resolve(appBundle);
  const verified = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=4", bundle]);
  if (verified.stdout) process.stdout.write(verified.stdout);
  if (verified.stderr) process.stderr.write(verified.stderr);
  if (verified.status !== 0) {
    process.exitCode = verified.status ?? 1;
    return;
  }

  const details = run("/usr/bin/codesign", ["-dv", "--verbose=4", bundle]);
  const detailText = `${details.stdout ?? ""}\n${details.stderr ?? ""}`;
  if (details.stdout) process.stdout.write(details.stdout);
  if (details.stderr) process.stderr.write(details.stderr);
  const classification = classifySignature(detailText);

  let notarizationAccepted = classification.stapled;
  if (classification.kind === "developer-id" && !notarizationAccepted) {
    const assessed = run("/usr/sbin/spctl", ["--assess", "--verbose=4", "--type", "execute", bundle]);
    if (assessed.stdout) process.stdout.write(assessed.stdout);
    if (assessed.stderr) process.stderr.write(assessed.stderr);
    notarizationAccepted = assessed.status === 0;
  }

  const errors = signatureRequirementErrors(classification, {
    requireDeveloperId: process.env.BACKCHAT_REQUIRE_DEVELOPER_ID === "1",
    notarizationAccepted,
  });

  if (classification.kind === "developer-id") {
    const entitlements = run("/usr/bin/codesign", ["-d", "--entitlements", ":-", bundle]);
    const text = `${entitlements.stdout ?? ""}\n${entitlements.stderr ?? ""}`;
    errors.push(...entitlementErrors(text));
    let addons = [];
    try {
      addons = await findNativeAddons(bundle);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    if (addons.length === 0) {
      errors.push("Developer ID app does not contain a signed native .node addon");
    }
    for (const addon of addons) {
      const addonInfo = await stat(addon);
      if (!addonInfo.isFile()) continue;
      const addonVerify = run("/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", addon]);
      if (addonVerify.status !== 0) {
        errors.push(`native module is not signed: ${addon}`);
      }
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
