import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("real broker E2E bridge contract", () => {
  it("routes test-only broker starts through main and preload instead of raw transcript cards", async () => {
    const [channels, ipc, preload, bridge] = await Promise.all([
      readFile(resolve(root, "src/shared/ipc-channels.ts"), "utf8"),
      readFile(resolve(root, "src/main/ipc.ts"), "utf8"),
      readFile(resolve(root, "src/preload/index.ts"), "utf8"),
      readFile(resolve(root, "e2e/test-bridge.ts"), "utf8"),
    ]);

    expect(channels).toContain('TestBeginBrokerRequest: "__test:beginBrokerRequest"');
    expect(ipc).toContain("InvokeChannel.TestBeginBrokerRequest");
    expect(ipc).toContain("void requestPermission(");
    expect(ipc).toContain("void requestElicitationForm(");
    expect(ipc).toContain("void requestElicitationUrl(");
    expect(ipc).toContain("void writeTextFile(");
    expect(ipc).toContain("return createTerminal(");
    expect(preload).toContain("beginBrokerRequest:");
    expect(bridge).toContain("async beginBrokerRequest(");
  });
});
