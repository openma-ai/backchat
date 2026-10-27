import { describe, expect, it } from "vitest";
import {
  agentUpdateStateFrom,
  summarizeAgentUpdates,
} from "./agent-update.js";

describe("managed-agent update state", () => {
  it("counts the agents with a newer version", () => {
    const summary = summarizeAgentUpdates([
      { id: "codex", label: "Codex", updateAvailable: true },
      { id: "claude", label: "Claude", updateAvailable: false },
      { id: "pi", label: "pi", updateAvailable: true },
    ]);

    expect(summary).toEqual({
      status: "updateAvailable",
      updatesAvailable: 2,
      agentId: null,
      agentLabel: null,
    });
  });

  it("reports an up-to-date list with no available updates", () => {
    const summary = summarizeAgentUpdates([
      { id: "codex", label: "Codex", updateAvailable: false },
    ]);

    expect(summary.status).toBe("upToDate");
    expect(summary.updatesAvailable).toBe(0);
  });

  it("lets an in-flight upgrade outrank a stale availability count", () => {
    const summary = summarizeAgentUpdates(
      [
        { id: "codex", label: "Codex", updateAvailable: true },
        { id: "pi", label: "pi", updateAvailable: false },
      ],
      "codex",
    );

    expect(summary.status).toBe("upgrading");
    expect(summary.agentId).toBe("codex");
    expect(summary.agentLabel).toBe("Codex");
  });

  it("carries the shared vocabulary into the renderer state", () => {
    const state = agentUpdateStateFrom(
      [{ id: "codex", label: "Codex", updateAvailable: true }],
      null,
      "2026-01-01T00:00:00.000Z",
    );

    expect(state.status).toBe("updateAvailable");
    expect(state.updatesAvailable).toBe(1);
    expect(state.error).toBeNull();
    expect(state.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
