import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFromTag,
  parseToVersion,
  updaterDownloadMode,
} from "./macos-stable-release-update-e2e.mjs";

test("parses stable release tags and target versions", () => {
  assert.equal(parseFromTag("v0.0.13"), "v0.0.13");
  assert.equal(parseToVersion("0.0.14"), "0.0.14");
  assert.throws(() => parseFromTag("0.0.13"));
  assert.throws(() => parseToVersion("v0.0.14"));
});

test("classifies updater logs for blockmap vs full download", () => {
  assert.equal(
    updaterDownloadMode("[updater] Download block maps\n"),
    "differential",
  );
  assert.equal(
    updaterDownloadMode("[updater] Cannot download differentially, fallback to full download\n"),
    "full",
  );
  assert.equal(updaterDownloadMode("[updater] checking for update\n"), "unknown");
});
