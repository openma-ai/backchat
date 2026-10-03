import { describe, expect, it } from "vitest";
import { cursorRepositoryUrl } from "./cursor-cloud-git.js";

describe("cursor repository urls", () => {
  it("normalizes https, scp, and ssh remotes and strips credentials", () => {
    expect(cursorRepositoryUrl("https://github.com/demo/app.git")).toBe("https://github.com/demo/app");
    expect(cursorRepositoryUrl("git@github.com:demo/app.git")).toBe("https://github.com/demo/app");
    expect(cursorRepositoryUrl("ssh://git@gitlab.example.com/group/app.git")).toBe("https://gitlab.example.com/group/app");
    expect(cursorRepositoryUrl("https://user:token@github.com/demo/app.git")).toBe("https://github.com/demo/app");
    expect(cursorRepositoryUrl("not a remote")).toBeNull();
  });
});
