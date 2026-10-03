import { describe, expect, it } from "vitest";
import { collapseUnsupportedWorkspaceRoots, commonParentDirectory } from "./workspace-roots";

describe("workspace root fallback", () => {
  it("finds the directory that contains every checkout", () => {
    expect(commonParentDirectory([
      "/work/ws/01-app",
      "/work/ws/02-docs",
    ])).toBe("/work/ws");
  });

  it("collapses an unsupported additional-directories error onto that parent", () => {
    expect(collapseUnsupportedWorkspaceRoots(
      new Error("ACP agent does not support additional workspace directories"),
      "/work/ws/01-app",
      ["/work/ws/02-docs"],
    )).toMatchObject({ cwd: "/work/ws" });
  });

  it("leaves other startup failures alone", () => {
    expect(collapseUnsupportedWorkspaceRoots(
      new Error("agent process exited during startup"),
      "/work/ws/01-app",
      ["/work/ws/02-docs"],
    )).toBeNull();
  });
});
