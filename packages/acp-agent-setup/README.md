# ACP Agent Setup SDK

Headless setup lifecycle for ACP-capable desktop hosts. The package is intended
to be reused by Backchat, Clash Space, and OpenMA surfaces without copying host
UI code or host settings schemas.

## Responsibilities

- Merge the ACP registry/catalog with host-provided agent overrides.
- Detect available binaries, including host-managed bin directories.
- Install, upgrade, and uninstall registry-managed ACP shims and managed
  adapters.
- Run one-process capability inspection for every detected agent at startup.
- Run agent authentication through a host-provided interactive launcher.
- Run one-process capability inspection for manually refreshed enabled agents, returning auth,
  `config_options`, commands, and modes together.

## Non-goals

- No renderer components or design tokens.
- No Backchat, Clash Space, or OpenMA settings schema dependency.
- No product-specific copy beyond the host-provided `managedByName` and
  terminal return instruction.
- No live ACP process during a normal list call. Hosts invoke the explicit
  warmup or enabled-agent refresh use case instead of composing probe flags.

## Host Adapter Shape

```ts
import {
  createAcpAgentSetupService,
  launchTerminalAuth,
} from "@open-managed-agents-desktop/acp-agent-setup";

const service = createAcpAgentSetupService({
  registryCachePath,
  acpBinDir,
  acpInstallRoot,
  managedByName: "Your Host",
  agentOverrides: () => [{
    id: "custom-agent",
    label: "Custom Agent",
    command: "/usr/local/bin/custom-agent",
    args: ["--acp"],
    env: { CUSTOM_AGENT_TOKEN: process.env.CUSTOM_AGENT_TOKEN },
  }],
  launchInteractiveAuth: (options) =>
    launchTerminalAuth(options, {
      returnInstruction: "Return to Your Host and check auth again.",
    }),
});

await service.warmup(); // startup policy: full inspection for every detected agent
await service.listAgents(); // inventory + cached snapshot, no live ACP probe
await service.refreshEnabledAgents(); // explicit manual full refresh
```
