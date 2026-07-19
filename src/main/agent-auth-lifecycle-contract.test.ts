import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(__dirname, path), "utf8");
}

describe("agent auth lifecycle boundary", () => {
  it("keeps auth discovery and authentication on the agent setup service IPC", () => {
    expect(source("../shared/ipc-channels.ts")).not.toContain("AcpAuthMethods");
    expect(source("../shared/ipc-channels.ts")).not.toContain("AcpAuthenticate");
    expect(source("../shared/api.ts")).not.toContain("acpAuthMethods");
    expect(source("../shared/api.ts")).not.toContain("acpAuthenticate");
    expect(source("../preload/index.ts")).not.toContain("acpAuthMethods");
    expect(source("../preload/index.ts")).not.toContain("acpAuthenticate");
    expect(source("ipc.ts")).not.toContain("InvokeChannel.AcpAuthMethods");
    expect(source("ipc.ts")).not.toContain("InvokeChannel.AcpAuthenticate");
  });

  it("does not maintain a second one-shot auth implementation in SessionManager", () => {
    const sessionManager = source("session-manager.ts");
    expect(sessionManager).not.toContain("probeAuthMethods(");
    expect(sessionManager).not.toContain("authenticateAgent(");
  });
});
