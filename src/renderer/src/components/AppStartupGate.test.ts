import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("app cold-start readiness gate", () => {
  it("shows the shell immediately while agent discovery runs in the background", () => {
    const gate = readFileSync(
      resolve(__dirname, "AppStartupGate.tsx"),
      "utf8",
    );
    const main = readFileSync(
      resolve(__dirname, "../main.tsx"),
      "utf8",
    );

    expect(gate).toContain("queryKey: AGENTS_QUERY_KEY");
    expect(gate).toContain('readiness: "snapshot"');
    expect(gate).toContain('readiness: "ready"');
    expect(gate).toContain("queryClient.setQueryData");
    expect(gate).not.toContain("queryFn: () => window.backchat.agentsList()");
    expect(gate).not.toMatch(/if \(query\.isPending\)\s*\{\s*return/);
    expect(gate).not.toContain("<OpenmaStartupLoader");
    expect(gate).toContain("{children}");
    expect(gate).toContain("AgentsLiveProbeContext");
    expect(gate).toContain("useAgentsLiveProbePending");
    expect(gate).toContain(".finally(() => {");
    expect(main).toContain("<AppStartupGate>");
    expect(main).toContain("</AppStartupGate>");
  });
});
