import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("composer harness live auth", () => {
  it("probes the selected harness through IPC and keeps auth out of the inventory cache", () => {
    const source = readFileSync(
      resolve(__dirname, "composer-harness-live-auth.ts"),
      "utf8",
    );
    const composer = readFileSync(
      resolve(__dirname, "../components/chat/Composer.tsx"),
      "utf8",
    );

    expect(source).toContain('liveProbeAgentId: agentId');
    expect(source).toContain("stripAuth");
    expect(composer).toContain("useComposerHarnessLiveAuth");
    expect(composer).toContain("authChecking");
    expect(source).toContain("SLOW_HARNESS_PROBE_MS");
    expect(source).toContain("slowAuthProbe");
    expect(composer).not.toContain("useAgentsLiveProbePending");
  });
});
