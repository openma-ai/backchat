import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it, vi } from "vitest";

const homes: string[] = [];

function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "backchat-settings-"));
  homes.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Fresh SettingsStore bound to a temp OMA home via the test-hook override. */
async function loadStore(home: string) {
  vi.stubEnv("BACKCHAT_TEST_HOOKS", "1");
  vi.stubEnv("BACKCHAT_HOME", home);
  vi.resetModules();
  return import("./settings-store.js");
}

function configToml(home: string) {
  return parseToml(readFileSync(join(home, "config.toml"), "utf8")) as {
    agents?: Record<string, unknown>[];
  };
}

describe("settings store <-> shared config.toml agents", () => {
  it("migrates Martty settings.json harnesses into config.toml on load", async () => {
    const home = makeHome();
    writeFileSync(join(home, "settings.json"), JSON.stringify({
      harnesses: [{
        id: "martty-agent",
        label: "M",
        command: "m-acp",
        args: ["@openma/pi-acp@beta"],
      }],
    }));

    const { settingsStore } = await loadStore(home);
    const settings = await settingsStore.load();

    expect(configToml(home).agents).toEqual([{
      id: "martty-agent",
      label_override: "M",
      command_override: "m-acp",
      args_override: ["@openma/pi-acp@beta"],
    }]);
    expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).harnesses)
      .toBeUndefined();
    expect(settings.agents).toContainEqual({
      id: "martty-agent",
      enabled: undefined,
      label_override: "M",
      command_override: "m-acp",
      args_override: ["@openma/pi-acp@beta"],
      env: [],
    });
  });

  it("keeps user-pinned arg versions verbatim through a set() round-trip", async () => {
    const home = makeHome();
    writeFileSync(join(home, "config.toml"), [
      "[appearance]",
      "",
      "[[agents]]",
      'id = "pi-beta"',
      'command_override = "npx"',
      'args_override = ["@openma/pi-acp@beta"]',
      "",
    ].join("\n"));

    const { settingsStore } = await loadStore(home);
    const settings = await settingsStore.load();
    await settingsStore.set(settings);

    const row = configToml(home).agents?.find((agent) => agent.id === "pi-beta");
    expect(row?.args_override).toEqual(["@openma/pi-acp@beta"]);
  });

  it("keeps a foreign [[agents]] row Martty wrote between load() and set()", async () => {
    const home = makeHome();
    const { settingsStore } = await loadStore(home);
    const settings = await settingsStore.load();

    writeFileSync(join(home, "config.toml"), [
      "[default]",
      "[appearance]",
      "",
      "[[agents]]",
      'id = "foreign"',
      'command_override = "f-acp"',
      "",
    ].join("\n"));
    await settingsStore.set(settings);

    expect(configToml(home).agents).toEqual([{ id: "foreign", command_override: "f-acp", env: [] }]);
    expect(settingsStore.get().agents).toContainEqual(
      expect.objectContaining({ id: "foreign", command_override: "f-acp" }),
    );
  });

  it("lets a Martty-side remove propagate when the row was not touched", async () => {
    const home = makeHome();
    writeFileSync(join(home, "config.toml"), [
      "[default]",
      "[appearance]",
      "",
      "[[agents]]",
      'id = "gone"',
      'command_override = "g-acp"',
      "",
      "[[agents]]",
      'id = "mine"',
      'command_override = "m-acp"',
      "",
    ].join("\n"));

    const { settingsStore } = await loadStore(home);
    const settings = await settingsStore.load();
    // Martty removes "gone", leaving a residual enabled flag on disk.
    writeFileSync(join(home, "config.toml"), [
      "[default]",
      "[appearance]",
      "",
      "[[agents]]",
      'id = "gone"',
      "enabled = true",
      "",
      "[[agents]]",
      'id = "mine"',
      'command_override = "m-acp"',
      "",
    ].join("\n"));

    await settingsStore.set(settings);
    expect(configToml(home).agents).toEqual([
      { id: "gone", enabled: true, env: [] },
      { id: "mine", command_override: "m-acp", env: [] },
    ]);
  });

  it("user edits win over what is on disk", async () => {
    const home = makeHome();
    writeFileSync(join(home, "config.toml"), [
      "[default]",
      "[appearance]",
      "",
      "[[agents]]",
      'id = "x"',
      'command_override = "old"',
      "",
    ].join("\n"));

    const { settingsStore } = await loadStore(home);
    const settings = await settingsStore.load();
    writeFileSync(join(home, "config.toml"), [
      "[default]",
      "[appearance]",
      "",
      "[[agents]]",
      'id = "x"',
      'command_override = "disk-new"',
      "",
    ].join("\n"));

    await settingsStore.set({
      ...settings,
      agents: settings.agents.map((agent) =>
        agent.id === "x" ? { ...agent, command_override: "user-new" } : agent),
    });
    expect(configToml(home).agents).toEqual([{ id: "x", command_override: "user-new", env: [] }]);
  });
});
