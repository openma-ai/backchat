import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("app cold-start readiness gate", () => {
  it("renders only the animated brand loader until the full agent barrier settles", () => {
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

    expect(gate).toContain('queryKey: ["agents"]');
    expect(gate).toContain("window.backchat.agentsList()");
    expect(gate).toContain("query.isPending");
    expect(gate).toContain("<OpenmaStartupLoader");
    expect(gate).not.toContain("Loading agents");
    expect(loader.match(/openma-startup-loader-dot/g)).toHaveLength(3);
    expect(loader).toContain('viewBox="240 244 548 454"');
    expect(main).toContain("<AppStartupGate>");
    expect(main).toContain("</AppStartupGate>");
  });
});
