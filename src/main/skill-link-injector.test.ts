import { lstat, mkdir, mkdtemp, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { reconcileSkillLinks } from "./skill-link-injector.js";

const cleanups: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  cleanups.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) =>
    rm(path, { recursive: true, force: true }),
  ));
});

describe("reconcileSkillLinks", () => {
  it("links enabled skills into the active agent registry directory", async () => {
    const cwd = await temporaryDirectory("backchat-skill-cwd-");
    const stateRoot = await temporaryDirectory("backchat-skill-state-");
    const skillRoot = await temporaryDirectory("backchat-skill-source-");
    await writeFile(join(skillRoot, "SKILL.md"), "# Skill\n", "utf8");

    const result = await reconcileSkillLinks({
      cwd,
      agentId: "codex-acp",
      stateRoot,
      skills: [{
        id: "builtin:create-backchat-theme",
        name: "create-backchat-theme",
        directory: skillRoot,
      }],
    });

    const link = join(cwd, ".agents", "skills", "create-backchat-theme");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realpath(link)).toBe(skillRoot);
    expect(result).toMatchObject({ linked: [link], removed: [], conflicts: [] });
  });

  it("removes only links recorded as BackChat-managed when a skill is disabled", async () => {
    const cwd = await temporaryDirectory("backchat-skill-cwd-");
    const stateRoot = await temporaryDirectory("backchat-skill-state-");
    const skillRoot = await temporaryDirectory("backchat-skill-source-");
    await writeFile(join(skillRoot, "SKILL.md"), "# Skill\n", "utf8");

    await reconcileSkillLinks({
      cwd,
      agentId: "claude-acp",
      stateRoot,
      skills: [{ id: "plugin:docs", name: "docs", directory: skillRoot }],
    });
    const link = join(cwd, ".claude", "skills", "docs");

    const result = await reconcileSkillLinks({
      cwd,
      agentId: "claude-acp",
      stateRoot,
      skills: [],
    });

    await expect(lstat(link)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.removed).toEqual([link]);
  });

  it("never replaces a user-owned file or foreign symlink", async () => {
    const cwd = await temporaryDirectory("backchat-skill-cwd-");
    const stateRoot = await temporaryDirectory("backchat-skill-state-");
    const skillRoot = await temporaryDirectory("backchat-skill-source-");
    const target = join(cwd, ".agents", "skills", "docs");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "README.md"), "mine\n", "utf8");

    const result = await reconcileSkillLinks({
      cwd,
      agentId: "codex-acp",
      stateRoot,
      skills: [{ id: "plugin:docs", name: "docs", directory: skillRoot }],
    });

    expect((await lstat(target)).isDirectory()).toBe(true);
    expect(result.conflicts).toEqual([target]);
    await expect(readlink(target)).rejects.toMatchObject({ code: "EINVAL" });
  });

  it("updates a previously managed link when a plugin skill moves", async () => {
    const cwd = await temporaryDirectory("backchat-skill-cwd-");
    const stateRoot = await temporaryDirectory("backchat-skill-state-");
    const firstRoot = await temporaryDirectory("backchat-skill-v1-");
    const secondRoot = await temporaryDirectory("backchat-skill-v2-");
    const skill = (directory: string) => ({
      id: "plugin:docs",
      name: "docs",
      directory,
    });

    await reconcileSkillLinks({
      cwd,
      agentId: "codex-acp",
      stateRoot,
      skills: [skill(firstRoot)],
    });
    const link = join(cwd, ".agents", "skills", "docs");

    const result = await reconcileSkillLinks({
      cwd,
      agentId: "codex-acp",
      stateRoot,
      skills: [skill(secondRoot)],
    });

    expect(await realpath(link)).toBe(secondRoot);
    expect(result.linked).toEqual([link]);
    expect(result.conflicts).toEqual([]);
  });

  it("serializes concurrent reconciliation for the same cwd and agent", async () => {
    const cwd = await temporaryDirectory("backchat-skill-cwd-");
    const stateRoot = await temporaryDirectory("backchat-skill-state-");
    const skillRoot = await temporaryDirectory("backchat-skill-source-");
    const input = {
      cwd,
      agentId: "codex-acp",
      stateRoot,
      skills: [{ id: "plugin:docs", name: "docs", directory: skillRoot }],
    };

    await expect(Promise.all([
      reconcileSkillLinks(input),
      reconcileSkillLinks(input),
    ])).resolves.toHaveLength(2);
    expect(await realpath(join(cwd, ".agents", "skills", "docs"))).toBe(skillRoot);
  });
});
