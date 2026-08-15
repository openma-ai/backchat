import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("app cold-start readiness gate", () => {
  it("holds first paint on the startup loader until the full agent probe is ready", () => {
    const gate = readFileSync(
      resolve(__dirname, "AppStartupGate.tsx"),
      "utf8",
    );
    const main = readFileSync(
      resolve(__dirname, "../main.tsx"),
      "utf8",
    );
    const loader = readFileSync(
      resolve(__dirname, "OpenmaStartupLoader.tsx"),
      "utf8",
    );

    expect(gate).toContain("queryKey: AGENTS_QUERY_KEY");
    expect(gate).toContain('readiness: "ready"');
    expect(gate).not.toContain('readiness: "snapshot"');
    expect(gate).not.toContain("queryClient.setQueryData");
    expect(gate).not.toContain("queryFn: () => window.backchat.agentsList()");
    expect(gate).toContain("query.isPending");
    expect(gate).toContain("<OpenmaStartupLoader");
    expect(gate).not.toContain("Loading agents");
    expect(loader.match(/openma-startup-loader-dot/g)).toHaveLength(3);
    expect(loader).toContain('viewBox="240 244 548 454"');
    expect(main).toContain("<AppStartupGate>");
    expect(main).toContain("</AppStartupGate>");
  });
});
