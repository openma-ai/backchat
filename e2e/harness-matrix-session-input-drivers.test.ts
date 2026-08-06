import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import { SESSION_INPUT_MATRIX_DRIVERS } from "./harness-matrix-session-input-drivers.js";

const EXPECTED_FEATURES = [
  "session.initialize-ready",
  "session.new-workspace",
  "session.load-history",
  "session.resume",
  "session.fork-side-chat",
  "session.side-chat-promote",
  "session.close-terminated",
  "session.local-archive-delete",
  "session.restart-replay",
  "input.prompt-text",
  "input.image-attachment",
  "input.resource-context",
  "input.session-reference",
  "input.available-commands",
  "input.mode",
  "input.config-model-reasoning",
  "input.cancel-stop",
  "input.steering",
  "input.queue",
  "output.streaming-response",
] as const;

test("exports every assigned session/input matrix feature exactly once", () => {
  assert.deepEqual(
    SESSION_INPUT_MATRIX_DRIVERS.map((driver) => driver.id),
    EXPECTED_FEATURES,
  );
  assert.equal(new Set(SESSION_INPUT_MATRIX_DRIVERS.map((driver) => driver.id)).size, 20);
  for (const driver of SESSION_INPUT_MATRIX_DRIVERS) {
    assert.equal(typeof driver.run, "function");
  }
});

test("does not create matrix-only evidence overlays", async () => {
  const source = await readFile(
    fileURLToPath(new URL("./harness-matrix-session-input-drivers.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(source, /createElement|matrix-evidence-overlay|installEvidenceOverlay/);
});
