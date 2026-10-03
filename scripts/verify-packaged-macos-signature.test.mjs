import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySignature,
  entitlementErrors,
  signatureRequirementErrors,
} from "./verify-packaged-macos-signature.mjs";

const adhoc = `
CodeDirectory v=20400 size=391 flags=0x2(adhoc) hashes=5+3
Signature=adhoc
TeamIdentifier=not set
`;

const developerId = `
CodeDirectory v=20500 size=512 flags=0x10000(runtime) hashes=8+7
Authority=Developer ID Application: Example (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Notarization Ticket=stapled
`;

test("ad-hoc without hardened runtime passes, and is rejected when signing was requested", () => {
  const classification = classifySignature(adhoc);
  assert.equal(classification.kind, "adhoc");
  assert.equal(classification.hardenedRuntime, false);
  assert.deepEqual(signatureRequirementErrors(classification, {
    requireDeveloperId: false,
    notarizationAccepted: false,
  }), []);
  assert.deepEqual(signatureRequirementErrors(classification, {
    requireDeveloperId: true,
    notarizationAccepted: false,
  }), ["expected a Developer ID Application signature, found an ad-hoc signature"]);
});

test("Developer ID must be hardened and notarized, without checking a specific team", () => {
  const classification = classifySignature(developerId);
  assert.equal(classification.kind, "developer-id");
  assert.equal(classification.hardenedRuntime, true);
  assert.equal(classification.stapled, true);
  assert.deepEqual(signatureRequirementErrors(classification, {
    requireDeveloperId: true,
    notarizationAccepted: false,
  }), []);
  const unsignedRuntime = classifySignature(developerId.replace("runtime", "library"));
  assert.ok(signatureRequirementErrors(unsignedRuntime, {
    requireDeveloperId: true,
    notarizationAccepted: true,
  }).some((error) => error.includes("hardened runtime")));
  const unnotarized = classifySignature(developerId.replace("Notarization Ticket=stapled", ""));
  assert.ok(signatureRequirementErrors(unnotarized, {
    requireDeveloperId: true,
    notarizationAccepted: false,
  }).some((error) => error.includes("not notarized")));
});

test("signed apps must keep the entitlements native modules and the bundled runtime need", () => {
  const entitlements = `
    <key>com.apple.security.cs.allow-jit</key>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <key>com.apple.security.cs.disable-library-validation</key>
  `;
  assert.deepEqual(entitlementErrors(entitlements), []);
  assert.ok(entitlementErrors("<plist></plist>").length >= 3);
});
