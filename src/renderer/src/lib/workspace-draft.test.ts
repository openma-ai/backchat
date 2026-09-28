import { describe, expect, it } from "vitest";
import { SessionStore } from "./session-store";

describe("workspace drafts", () => {
  it("retains the parent project directory and workspace without a saved project id", () => {
    const store = new SessionStore();
    const id = store.newDraft({
      sourceFolders: ["/projects/hilo", "/projects/shared"],
      workspaceId: "fix-abc",
    });
    expect(store.get(id)).toMatchObject({
      chosenCwd: "/projects/hilo", additionalDirectories: ["/projects/shared"],
      workspaceId: "fix-abc", projectScope: "project", status: "draft",
    });
    expect(store.get(id)?.projectId).toBeUndefined();
  });
});
