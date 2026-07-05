import { describe, expect, it } from "vitest";
import type { Settings } from "@shared/settings";
import {
  customAgentRows,
  parseCustomAgentArgs,
  parseCustomAgentEnv,
  removeCustomAgentServer,
  upsertCustomAgentServer,
} from "./custom-agent-settings";

const baseSettings: Settings = {
  default: {
    agent_id: "",
    workspace_path: "",
    permission_mode: "ask",
    prompt_queue_enabled: true,
  },
  appearance: {
    theme: "system",
    font_size: "md",
    density: "default",
  },
  agents: [],
  mcp_servers: [],
};

describe("custom agent settings", () => {
  it("parses one argument per line", () => {
    expect(parseCustomAgentArgs("\n--acp\n--profile=work\n\n")).toEqual([
      "--acp",
      "--profile=work",
    ]);
  });

  it("parses env vars from KEY=value lines", () => {
    expect(parseCustomAgentEnv("\nOPENAI_API_KEY=sk-test\nEMPTY=\n")).toEqual([
      { name: "OPENAI_API_KEY", value: "sk-test" },
      { name: "EMPTY", value: "" },
    ]);
  });

  it("upserts command-backed custom servers into agent overrides", () => {
    const agents = upsertCustomAgentServer(baseSettings, {
      id: "studio",
      label: "Studio ACP",
      command: "/usr/local/bin/studio-acp",
      argsText: "--acp",
      envText: "STUDIO_TOKEN=secret",
    });

    expect(agents).toEqual([{
      id: "studio",
      enabled: true,
      label_override: "Studio ACP",
      command_override: "/usr/local/bin/studio-acp",
      args_override: ["--acp"],
      env: [{ name: "STUDIO_TOKEN", value: "secret" }],
    }]);
    expect(customAgentRows({ ...baseSettings, agents })).toEqual([{
      id: "studio",
      label: "Studio ACP",
      command: "/usr/local/bin/studio-acp",
      argsText: "--acp",
      envText: "STUDIO_TOKEN=secret",
    }]);
  });

  it("removes only the command-backed custom server override", () => {
    const settings: Settings = {
      ...baseSettings,
      agents: [
        {
          id: "studio",
          label_override: "Studio ACP",
          command_override: "/usr/local/bin/studio-acp",
          args_override: ["--acp"],
          env: [],
        },
        {
          id: "qwen-code",
          env: [{ name: "OPENAI_API_KEY", value: "sk-test" }],
        },
      ],
    };

    expect(removeCustomAgentServer(settings, "studio")).toEqual([{
      id: "qwen-code",
      env: [{ name: "OPENAI_API_KEY", value: "sk-test" }],
    }]);
  });
});
