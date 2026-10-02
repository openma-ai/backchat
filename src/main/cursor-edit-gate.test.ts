import { describe, expect, it } from "vitest";
import { cursorMayEditDirectly, restrictCursorEdits, type CursorEditSession } from "./cursor-edit-gate.js";

function session(modes: string[], current = "agent"): CursorEditSession & { modeIds: string[] } {
  const state = {
    currentModeId: current,
    availableModes: modes.map((id) => ({ id, name: id })),
    configValue: current,
  };
  return {
    modeIds: [],
    modes: state,
    configOptions: [{
      id: "mode",
      type: "select",
      currentValue: current,
      options: modes.map((id) => ({ value: id, name: id })),
    }],
    async setMode(modeId: string) {
      state.currentModeId = modeId;
      this.modeIds.push(modeId);
    },
    async setConfigOption(configId: string, value: string | boolean) {
      if (configId === "mode" && typeof value === "string") {
        state.configValue = value;
        const option = this.configOptions.find((entry) => entry.id === configId);
        if (option) option.currentValue = value;
      }
      return this.configOptions;
    },
  };
}

describe("Cursor edit gate", () => {
  it("allows direct edits only for an explicit opt-in", () => {
    expect(cursorMayEditDirectly({ policy: "auto-all" })).toBe(true);
    expect(cursorMayEditDirectly({ permissionMode: "auto" })).toBe(true);
    expect(cursorMayEditDirectly({ policy: "ask" })).toBe(false);
    expect(cursorMayEditDirectly({ policy: "auto-read" })).toBe(false);
    expect(cursorMayEditDirectly({})).toBe(false);
    expect(cursorMayEditDirectly({ policy: "auto-all", permissionMode: "read_only" })).toBe(false);
  });

  it("prefers ask mode and does not need a repo config file", async () => {
    const cursor = session(["agent", "plan", "ask"]);
    await expect(restrictCursorEdits(cursor, {
      agentId: "cursor",
      policy: "auto-read",
    })).resolves.toEqual({ action: "restricted", mode: "ask" });
    expect(cursor.modes?.currentModeId).toBe("ask");
    expect(cursor.modeIds).toEqual(["ask"]);
  });

  it("falls back to plan mode", async () => {
    const cursor = session(["agent", "plan"]);
    await expect(restrictCursorEdits(cursor, {
      agentId: "cursor-acp",
      permissionMode: "ask",
    })).resolves.toEqual({ action: "restricted", mode: "plan" });
    expect(cursor.modes?.currentModeId).toBe("plan");
  });

  it("blocks when the mode switch does not stick", async () => {
    const cursor = session(["agent", "ask"]);
    cursor.setMode = async () => undefined;
    cursor.setConfigOption = async () => cursor.configOptions;
    const result = await restrictCursorEdits(cursor, { agentId: "cursor", policy: "ask" });
    expect(result).toMatchObject({
      action: "blocked",
      message: expect.stringContaining("stayed in a mode"),
    });
    expect(cursor.modes?.currentModeId).toBe("agent");
  });

  it("blocks startup when Cursor would stay in agent mode", async () => {
    const cursor = session(["agent"]);
    cursor.setMode = async () => undefined;
    const result = await restrictCursorEdits(cursor, { agentId: "cursor", policy: "ask" });
    expect(result.action).toBe("blocked");
    expect(cursor.modes?.currentModeId).toBe("agent");
  });

  it("leaves agent mode when the caller opts into direct edits", async () => {
    const cursor = session(["agent", "plan", "ask"]);
    await expect(restrictCursorEdits(cursor, {
      agentId: "cursor",
      policy: "auto-all",
    })).resolves.toEqual({ action: "allow" });
    expect(cursor.modeIds).toEqual([]);
  });
});
