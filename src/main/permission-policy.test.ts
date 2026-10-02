import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

import { listPendingAsks, requestPermission, respondPermission } from "./brokers.js";
import { isReadOnlyToolCall, setRuntimePermissionPolicy } from "./permission-policy.js";

describe("session permission policy", () => {
  it("auto-approves read-only tools and keeps writes pending", async () => {
    setRuntimePermissionPolicy("sess-policy", "auto-read");
    await expect(requestPermission("sess-policy", {
      toolCall: { kind: "read", title: "Read file" },
      options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
    })).resolves.toEqual({ outcome: { outcome: "selected", optionId: "allow" } });

    const pending = requestPermission("sess-policy", {
      toolCall: { kind: "edit", title: "Write file" },
      options: [{ optionId: "write-once", kind: "allow_once", name: "Allow" }],
    });
    const asks = listPendingAsks("sess-policy");
    expect(asks).toEqual([
      expect.objectContaining({ kind: "permission", title: "Write file" }),
    ]);
    expect(respondPermission(asks[0]!.id, asks[0]!.options![0]!.optionId)).toBe(true);
    await expect(pending).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "write-once" },
    });
  });

  it("treats edit, write, delete, move, and shell-like names as not read-only", () => {
    for (const kind of ["edit", "write", "delete", "move", "execute", "other"]) {
      expect(isReadOnlyToolCall({ kind })).toBe(false);
    }
    expect(isReadOnlyToolCall({ kind: "read", title: "shell ls" })).toBe(false);
    expect(isReadOnlyToolCall({ title: "Edit file" })).toBe(false);
    expect(isReadOnlyToolCall({ kind: "read", title: "Read file" })).toBe(true);
  });
});
