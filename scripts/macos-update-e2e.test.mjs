import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  UPDATE_E2E_EVIDENCE_PATH,
  assertInstalledUpdate,
  assertOutsideStayed,
  localizeFeedYaml,
  previewVersion,
  zipNameFromFeedYaml,
} from "./macos-update-e2e.mjs";

const yml = `version: 0.0.12-preview.910002
files:
  - url: Backchat-0.0.12-preview.910002-mac.zip
    sha512: abcdef==
    size: 10
path: Backchat-0.0.12-preview.910002-mac.zip
sha512: abcdef==
releaseDate: '2026-10-03T00:00:00.000Z'
`;

test("preview versions and the local feed keep the zip hash", () => {
  assert.equal(previewVersion("0.0.12", 910001), "0.0.12-preview.910001");
  assert.equal(zipNameFromFeedYaml(yml), "Backchat-0.0.12-preview.910002-mac.zip");
  const local = localizeFeedYaml(yml, "Backchat-0.0.12-preview.910002-mac.zip");
  assert.match(local, /sha512: abcdef==/);
  assert.doesNotMatch(local, /https?:/);
  assert.equal(UPDATE_E2E_EVIDENCE_PATH, "/tmp/backchat-update-evidence.log");
  assert.match(readFileSync(new URL("../src/shared/app-update.ts", import.meta.url), "utf8"), /\/tmp\/backchat-update-evidence\.log/);
});

test("a copy outside /Applications must not accept or leave", () => {
  const evidence = [
    { event: "update-state", pid: 4, status: "checking", installBlock: "location" },
    { event: "update-state", pid: 4, status: "available", installBlock: "location" },
  ];
  const samples = [
    { t: "2026-10-03T00:00:00.000Z", oldPidAlive: true, socketExists: false, version: "0.0.12-preview.910001" },
    { t: "2026-10-03T00:00:01.000Z", oldPidAlive: true, socketExists: true, version: "0.0.12-preview.910001" },
    { t: "2026-10-03T00:00:02.000Z", oldPidAlive: true, socketExists: true, version: "0.0.12-preview.910001" },
  ];
  assert.deepEqual(assertOutsideStayed({
    oldVersion: "0.0.12-preview.910001",
    oldPid: 4,
    evidence,
    samples,
  }), []);
  const accepted = [...evidence, { event: "update-accepted", pid: 4, version: "0.0.12-preview.910002" }];
  assert.ok(assertOutsideStayed({
    oldVersion: "0.0.12-preview.910001",
    oldPid: 4,
    evidence: accepted,
    samples,
  }).length > 0);
});

test("the installed app must close the control socket before the new version is visible", () => {
  const oldVersion = "0.0.12-preview.910001";
  const newVersion = "0.0.12-preview.910002";
  const evidence = [
    { event: "update-accepted", pid: 9, timestamp: "2026-10-03T00:00:02.000Z", version: newVersion },
    { event: "quit-and-install", pid: 9, timestamp: "2026-10-03T00:00:02.100Z", version: newVersion },
    { event: "control-socket-closed", pid: 9, timestamp: "2026-10-03T00:00:02.200Z", socket: "/Users/runner/.oma/control.sock" },
  ];
  const samples = [
    { t: "2026-10-03T00:00:01.000Z", oldPidAlive: true, newPid: 0, socketExists: true, version: oldVersion },
    { t: "2026-10-03T00:00:03.000Z", oldPidAlive: false, newPid: 0, socketExists: false, version: oldVersion },
    { t: "2026-10-03T00:00:04.000Z", oldPidAlive: false, newPid: 20, socketExists: true, version: newVersion },
  ];
  assert.deepEqual(assertInstalledUpdate({
    oldVersion,
    newVersion,
    oldPid: 9,
    evidence,
    samples,
    socketPath: "/Users/runner/.oma/control.sock",
  }), []);
  const swappedEarly = [
    { t: "2026-10-03T00:00:01.000Z", oldPidAlive: true, newPid: 0, socketExists: true, version: oldVersion },
    { t: "2026-10-03T00:00:02.000Z", oldPidAlive: true, newPid: 0, socketExists: true, version: newVersion },
  ];
  assert.ok(assertInstalledUpdate({
    oldVersion,
    newVersion,
    oldPid: 9,
    evidence,
    samples: swappedEarly,
    socketPath: "/Users/runner/.oma/control.sock",
  }).some((error) => error.includes("still running")));
});
