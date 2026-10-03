import assert from "node:assert/strict";
import test from "node:test";
import { buildNumberFromEnv, channelFromEnv } from "./write-update-metadata.mjs";

test("preview builds come from main and stable builds come from a version tag", () => {
  assert.equal(channelFromEnv({ GITHUB_REF: "refs/heads/main" }), "preview");
  assert.equal(channelFromEnv({ GITHUB_REF: "refs/tags/v0.0.12" }), "stable");
  assert.equal(channelFromEnv({ GITHUB_REF: "refs/heads/feature" }), "dev");
  assert.equal(channelFromEnv({
    GITHUB_REF: "refs/heads/main",
    BACKCHAT_UPDATE_CHANNEL: "stable",
  }), "stable");
});

test("a re-run gets a greater build number than the first attempt", () => {
  assert.equal(buildNumberFromEnv({}), 0);
  assert.equal(buildNumberFromEnv({ GITHUB_RUN_NUMBER: "42", GITHUB_RUN_ATTEMPT: "1" }), 42001);
  assert.equal(buildNumberFromEnv({ GITHUB_RUN_NUMBER: "42", GITHUB_RUN_ATTEMPT: "2" }), 42002);
  assert.equal(buildNumberFromEnv({ GITHUB_RUN_NUMBER: "43", GITHUB_RUN_ATTEMPT: "1" }), 43001);
  assert.equal(buildNumberFromEnv({ BACKCHAT_UPDATE_BUILD: "7" }), 7);
  assert.throws(() => buildNumberFromEnv({ BACKCHAT_UPDATE_BUILD: "1.5" }), /integer/);
});
