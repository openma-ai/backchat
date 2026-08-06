import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { harnessMatrixCallbackNativeDrivers } from "./harness-matrix-callback-native-drivers";
import type {
  MatrixDriverContext,
  MatrixHarness,
} from "./harness-matrix-driver-types";

function nativeDriver(id: string) {
  const driver = harnessMatrixCallbackNativeDrivers.find((candidate) => candidate.id === id);
  assert.ok(driver, `missing matrix driver ${id}`);
  return driver;
}

function nativeDriverContext(harness: MatrixHarness) {
  const events: Record<string, unknown>[] = [];
  const locator = {
    click: async () => undefined,
    evaluate: async () => "structured native evidence is visible",
    filter: () => locator,
    getByRole: () => locator,
    getByTestId: () => locator,
    getByText: () => locator,
    isVisible: async () => true,
    last: () => locator,
    locator: () => locator,
    scrollIntoViewIfNeeded: async () => undefined,
    waitFor: async () => undefined,
  };
  const page = {
    getByRole: () => locator,
    getByText: () => locator,
    keyboard: { press: async () => undefined },
    locator: () => locator,
  };
  const context: MatrixDriverContext = {
    page: page as unknown as MatrixDriverContext["page"],
    bridge: {} as MatrixDriverContext["bridge"],
    harness,
    sessionId: `matrix-${harness.id}`,
    turnId: `turn-matrix-${harness.id}`,
    cwd: "/work",
    injectEvent: async (event) => {
      events.push(event);
    },
    injectSession: async () => undefined,
  };
  return { context, events };
}

describe("harnessMatrixCallbackNativeDrivers", () => {
  it("covers callback, runtime, resource, native-agent, and raw features 31 through 45", () => {
    assert.deepEqual(harnessMatrixCallbackNativeDrivers.map((driver) => driver.id), [
      "callback.permission",
      "callback.filesystem",
      "callback.terminal",
      "callback.elicitation-form",
      "callback.elicitation-url",
      "callback.mcp-extension",
      "runtime.foreground-terminal",
      "runtime.background-work",
      "runtime.claude-monitor",
      "runtime.resources",
      "agent.native-list-lifecycle",
      "agent.native-detail",
      "agent.native-transcript",
      "agent.native-final",
      "runtime.vendor-raw",
    ]);
  });

  it("does not ship overlay-based evidence", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("./harness-matrix-callback-native-drivers.ts", import.meta.url), "utf8")
    );
    assert.doesNotMatch(source, /overlay|document\.createElement|innerHTML/iu);
  });

  it("uses Cursor cursor/task identity with its correlated standard tool status for list and detail", async () => {
    for (const driverId of ["agent.native-list-lifecycle", "agent.native-detail"]) {
      const { context, events } = nativeDriverContext({
        id: "cursor",
        label: "Cursor",
        version: "2026.07.23",
      });
      const result = await nativeDriver(driverId).run(context);

      assert.equal(result.status, "pass-replay");
      const updates = events.map((outer) => outer.event as Record<string, unknown>);
      const extension = updates.find((event) => event.method === "cursor/task");
      assert.deepEqual(extension, {
        type: "acp.extension_request",
        method: "cursor/task",
        params: {
          toolCallId: "cursor-native-tool-matrix-cursor",
          description: "Audit matrix callbacks matrix-cursor",
          subagentType: "explore",
          agentId: "cursor-native-child-matrix-cursor",
          durationMs: 1250,
        },
      });
      assert.deepEqual(
        updates
          .filter((event) => event.toolCallId === "cursor-native-tool-matrix-cursor")
          .map((event) => event.status)
          .filter(Boolean),
        ["in_progress", "completed"],
      );
    }
  });

  it("uses only structured parent and child session metadata for OpenCode and Kilo list and detail", async () => {
    for (const harness of [
      { id: "opencode", label: "OpenCode", version: "1.18.12" },
      { id: "kilo", label: "Kilo", version: "7.4.19" },
    ]) {
      for (const driverId of ["agent.native-list-lifecycle", "agent.native-detail"]) {
        const { context, events } = nativeDriverContext(harness);
        const result = await nativeDriver(driverId).run(context);

        assert.equal(result.status, "pass-replay");
        const updates = events.map((outer) => outer.event as Record<string, unknown>);
        const completed = updates.find((event) => event.status === "completed");
        assert.deepEqual(completed?.rawOutput, {
          metadata: {
            parentSessionId: `matrix-${harness.id}`,
            sessionId: `${harness.id}-native-child-matrix-${harness.id}`,
            model: harness.id === "opencode"
              ? { providerID: "deepseek", modelID: "deepseek-v4-pro" }
              : { providerID: "kilo", modelID: "auto" },
            ...(harness.id === "kilo" ? { variant: "high" } : {}),
          },
        });
        assert.doesNotMatch(JSON.stringify(events), /<task\b|task_result|task_error/iu);
      }
    }
  });

  it("marks undeclared Cursor OpenCode and Kilo transcript and final capabilities as not applicable", async () => {
    for (const harness of [
      { id: "cursor", label: "Cursor", version: "2026.07.23" },
      { id: "opencode", label: "OpenCode", version: "1.18.12" },
      { id: "kilo", label: "Kilo", version: "7.4.19" },
    ]) {
      for (const driverId of ["agent.native-transcript", "agent.native-final"]) {
        const { context, events } = nativeDriverContext(harness);
        const result = await nativeDriver(driverId).run(context);

        assert.equal(result.status, "n-a");
        assert.deepEqual(events, []);
        assert.doesNotMatch(result.expected, /usage|token/iu);
      }
    }
  });

  it("marks all four native features not applicable for Pi and Kimi Code", async () => {
    for (const harness of [
      { id: "pi-acp", label: "Pi", version: "0.0.33" },
      { id: "kimi", label: "Kimi Code", version: "0.33.0" },
    ]) {
      for (const driverId of [
        "agent.native-list-lifecycle",
        "agent.native-detail",
        "agent.native-transcript",
        "agent.native-final",
      ]) {
        const { context, events } = nativeDriverContext(harness);
        const result = await nativeDriver(driverId).run(context);

        assert.equal(result.status, "n-a");
        assert.deepEqual(events, []);
      }
    }
  });

  it("verifies Claude and Codex child final without requiring child usage", async () => {
    for (const harness of [
      { id: "claude-acp", label: "Claude", version: "0.64.2" },
      { id: "codex-acp", label: "Codex", version: "1.1.9" },
    ]) {
      const { context } = nativeDriverContext(harness);
      const result = await nativeDriver("agent.native-final").run(context);

      assert.equal(result.status, "pass-replay");
      assert.match(result.expected, /child final/iu);
      assert.doesNotMatch(`${result.expected} ${result.trigger}`, /usage|token/iu);
    }
  });
});
