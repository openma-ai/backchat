import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  hasDeprecatedAgentDefault,
  migrateDeprecatedWorkspacePath,
} from "./settings-store";

describe("settings migrations", () => {
  it("recognizes and removes the legacy static agent default", () => {
    expect(hasDeprecatedAgentDefault({
      default: { agent_id: "codex-acp" },
    })).toBe(true);
    expect(hasDeprecatedAgentDefault({
      default: { permission_mode: "ask" },
    })).toBe(false);
    expect(DEFAULT_SETTINGS.default).not.toHaveProperty("agent_id");
  });

  it("clears the invisible legacy default workspace", () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      default: {
        ...DEFAULT_SETTINGS.default,
        workspace_path: "/Users/mini/Proj/old-default",
      },
    };

    expect(migrateDeprecatedWorkspacePath(legacy)).toEqual({
      changed: true,
      settings: {
        ...legacy,
        default: {
          ...legacy.default,
          workspace_path: "",
        },
      },
    });
  });

  it("leaves an already empty workspace setting untouched", () => {
    expect(migrateDeprecatedWorkspacePath(DEFAULT_SETTINGS)).toEqual({
      changed: false,
      settings: DEFAULT_SETTINGS,
    });
  });
});
