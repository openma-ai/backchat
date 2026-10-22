import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { AgentInfo } from "@shared/api.js";
import { AGENTS_QUERY_KEY } from "./agent-query";
import {
  composerHarnessLiveAuthKey,
  syncLiveSessionHarnessCache,
} from "./composer-harness-live-auth";

describe("composer harness live auth", () => {
  it("probes the selected harness through IPC and caches indefinitely across new sessions", () => {
    const source = readFileSync(
      resolve(__dirname, "composer-harness-live-auth.ts"),
      "utf8",
    );
    const composer = readFileSync(
      resolve(__dirname, "../components/chat/Composer.tsx"),
      "utf8",
    );

    expect(source).toContain("liveProbeAgentId: agentId");
    expect(source).toContain("stripAuth");
    expect(source).toContain("staleTime: Infinity");
    expect(source).toContain("gcTime: Infinity");
    expect(source).toContain('query.isPending && query.fetchStatus === "fetching"');
    expect(composer).toContain("useComposerHarnessLiveAuth");
    expect(composer).toContain("authChecking");
    expect(source).toContain("SLOW_HARNESS_PROBE_MS");
    expect(source).toContain("slowAuthProbe");
    expect(composer).not.toContain("useAgentsLiveProbePending");
  });

  it("updates cached harness config, slash commands, and auth when a real session reports updates", () => {
    const queryClient = new QueryClient();
    const initialAgents: AgentInfo[] = [
      {
        id: "pi-acp",
        label: "Pi ACP",
        command: "pi-acp",
        detected: true,
        available: true,
        auth: { status: "needs-auth", message: "Sign in" },
        config_options: [
          {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "old-model",
            options: [{ value: "old-model", name: "Old Model" }],
          },
        ],
        available_commands: [{ name: "help", description: "Help" }],
      },
    ];
    queryClient.setQueryData(AGENTS_QUERY_KEY, initialAgents);
    queryClient.setQueryData(composerHarnessLiveAuthKey("pi-acp"), initialAgents[0]!.auth);

    syncLiveSessionHarnessCache(queryClient, {
      agentId: "pi-acp",
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "new-model",
          options: [{ value: "new-model", name: "New Model" }],
        },
      ],
      availableCommands: [
        { name: "help", description: "Help" },
        { name: "compact", description: "Compact context" },
      ],
      sessionAuth: { status: "configured", message: "ACP auth is configured." },
      sessionAuthRequired: false,
    });

    const updatedAgents = queryClient.getQueryData<AgentInfo[]>(AGENTS_QUERY_KEY);
    expect(updatedAgents?.[0]?.auth).toMatchObject({ status: "configured" });
    expect(updatedAgents?.[0]?.config_options).toEqual([
      expect.objectContaining({ id: "model", currentValue: "new-model" }),
    ]);
    expect(updatedAgents?.[0]?.available_commands).toEqual([
      { name: "help", description: "Help" },
      { name: "compact", description: "Compact context" },
    ]);
    expect(queryClient.getQueryData(composerHarnessLiveAuthKey("pi-acp"))).toMatchObject({
      status: "configured",
    });
  });
});
