import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import type { KnownAgentEntry } from "@open-managed-agents-desktop/acp/registry";

import { computeAuthProbeInputsKey } from "./auth-probe-inputs.js";

const codexEntry: KnownAgentEntry = {
  id: "codex-acp",
  label: "Codex",
  spec: { command: "codex-acp", env: { OPENAI_API_KEY: "sk-one" } },
};

describe("computeAuthProbeInputsKey", () => {
  it("changes when agent env overrides change", async () => {
    const first = await computeAuthProbeInputsKey(codexEntry);
    const second = await computeAuthProbeInputsKey({
      ...codexEntry,
      spec: {
        ...codexEntry.spec,
        env: { OPENAI_API_KEY: "sk-two" },
      },
    });
    expect(first).not.toBe(second);
  });

  it("changes when codex provider config changes", async () => {
    const root = join(tmpdir(), `codex-auth-inputs-${process.pid}-${Date.now()}`);
    const codexDir = join(root, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      join(codexDir, "config.toml"),
      'model_provider = "openai"\n',
      "utf8",
    );

    const first = await computeAuthProbeInputsKey(codexEntry, root);
    await writeFile(
      join(codexDir, "config.toml"),
      'model_provider = "cliproxy"\nbase_url = "http://127.0.0.1:8317/v1"\n',
      "utf8",
    );
    const second = await computeAuthProbeInputsKey(codexEntry, root);
    expect(first).not.toBe(second);
    await rm(root, { recursive: true, force: true });
  });
});
