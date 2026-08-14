import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("BackChat skills and plugins integration", () => {
  it("filters plugin capabilities and reconciles native links before ACP startup", async () => {
    const ipc = await readFile(new URL("./ipc.ts", import.meta.url), "utf8");

    expect(ipc).toContain("settings.skills_plugins.disabled_plugins");
    expect(ipc).toContain("settings.skills_plugins.schedules_enabled");
    expect(ipc).toContain("reconcileSkillLinks");
    expect(ipc).toContain("prepareSessionCwd:");
  });

  it("ships BackChat's bundled skills outside the application archive", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { build?: { extraResources?: unknown } };
    expect(packageJson.build?.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "skills", to: "skills" }),
      ]),
    );
  });
});
