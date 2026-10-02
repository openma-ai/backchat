import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPiAgentSettingsShadow,
  isolatePiAgentSettingsForSpawn,
  removePiAgentSettingsShadow,
  resolvePiAgentDir,
  stripPiAgentDirArgs,
} from "./pi-settings-isolation";

async function sha256(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

describe("pi settings isolation", () => {
  it("prefers --agent-dir over PI_CODING_AGENT_DIR and the default home", () => {
    expect(resolvePiAgentDir({
      args: ["--quiet-startup", "--agent-dir", "/tmp/from-args"],
      env: { PI_CODING_AGENT_DIR: "/tmp/from-env" },
      homeDir: "/tmp/home",
    })).toBe("/tmp/from-args");
    expect(resolvePiAgentDir({
      args: ["--agent-dir=/tmp/inline"],
      homeDir: "/tmp/home",
    })).toBe("/tmp/inline");
    expect(resolvePiAgentDir({
      env: { PI_CODING_AGENT_DIR: "/tmp/from-env" },
      homeDir: "/tmp/home",
    })).toBe("/tmp/from-env");
    expect(resolvePiAgentDir({ homeDir: "/tmp/home" })).toBe("/tmp/home/.pi/agent");
  });

  it("strips --agent-dir so the spawn cannot point back at the user's dir", () => {
    expect(stripPiAgentDirArgs([
      "--quiet-startup",
      "--agent-dir",
      "/tmp/real",
      "--agent-dir=/tmp/also-real",
      "--model",
      "provider/id",
    ])).toEqual(["--quiet-startup", "--model", "provider/id"]);
  });

  it("keeps the user's settings.json hash stable when the shadow copy is rewritten", async () => {
    const root = join(tmpdir(), `pi-settings-isolation-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const source = join(root, "agent");
    const shadow = join(root, "shadow");
    const original = `${JSON.stringify({
      defaultProvider: "anthropic-proxy",
      defaultModel: "claude-fable-5-1",
      defaultThinkingLevel: "medium",
    }, null, 2)}\n`;
    try {
      await mkdir(join(source, "sessions"), { recursive: true });
      await writeFile(join(source, "settings.json"), original);
      await writeFile(join(source, "models.json"), "{\"kept\":true}\n");
      await writeFile(join(source, "sessions", "keep.txt"), "session-row\n");
      await symlink(join(source, "models.json"), join(source, "models-link.json"));

      const before = await sha256(join(source, "settings.json"));
      await createPiAgentSettingsShadow({ sourceAgentDir: source, shadowDir: shadow });

      const shadowSettings = JSON.parse(await readFile(join(shadow, "settings.json"), "utf8")) as {
        defaultModel?: string;
      };
      shadowSettings.defaultModel = "MiniMax-M3.1-Flash-Preview";
      await writeFile(
        join(shadow, "settings.json"),
        `${JSON.stringify(shadowSettings, null, 2)}\n`,
      );

      expect(await sha256(join(source, "settings.json"))).toBe(before);
      expect(await readFile(join(source, "settings.json"), "utf8")).toBe(original);
      expect((await lstat(join(shadow, "models.json"))).isSymbolicLink()).toBe(true);
      expect((await lstat(join(shadow, "sessions"))).isSymbolicLink()).toBe(true);
      expect(await readFile(join(shadow, "sessions", "keep.txt"), "utf8")).toBe("session-row\n");

      await removePiAgentSettingsShadow(shadow);
      expect(await readFile(join(source, "sessions", "keep.txt"), "utf8")).toBe("session-row\n");
      expect(await readFile(join(source, "settings.json"), "utf8")).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("points the spawn at the shadow and leaves a missing agent dir uncreated", async () => {
    const root = join(tmpdir(), `pi-settings-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const source = join(root, "missing-agent");
    const shadow = join(root, "shadow");
    try {
      const isolated = await isolatePiAgentSettingsForSpawn({
        args: ["--agent-dir", source, "--quiet-startup"],
        env: { PI_ACP_MODEL: "minimax-m31/MiniMax-M3.1" },
        shadowDir: shadow,
      });
      expect(isolated.sourceAgentDir).toBe(source);
      expect(isolated.shadowDir).toBe(shadow);
      expect(isolated.args).toEqual(["--quiet-startup"]);
      expect(isolated.env.PI_CODING_AGENT_DIR).toBe(shadow);
      expect(isolated.env.PI_ACP_MODEL).toBe("minimax-m31/MiniMax-M3.1");
      await expect(readFile(join(source, "settings.json"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
