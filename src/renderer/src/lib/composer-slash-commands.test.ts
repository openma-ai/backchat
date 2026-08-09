import { describe, expect, it } from "vitest";

import {
  buildSlashCommandSections,
  hostSessionStateAction,
  isHostForkSlashCommand,
  isSkillSlashCommand,
  matchesSlashCommand,
  normalizeAgentAvailableCommands,
  skillCommandLabel,
  slashCommandConfigAction,
  slashCommandQuery,
  withSessionStateCommands,
  withHostForkCommand,
} from "./composer-slash-commands";
import type { AcpSessionConfigOption } from "./session-config-options";

const collaborationMode: AcpSessionConfigOption = {
  id: "collaboration_mode",
  name: "Collaboration mode",
  type: "select",
  currentValue: "default",
  options: [
    { value: "default", name: "Default" },
    { value: "plan", name: "Plan" },
  ],
};

describe("composer slash commands", () => {
  it("parses only a leading slash token before arguments begin", () => {
    expect(slashCommandQuery("/")).toBe("");
    expect(slashCommandQuery("/compact")).toBe("compact");
    expect(slashCommandQuery("/compact now")).toBeNull();
    expect(slashCommandQuery(" /compact")).toBeNull();
    expect(slashCommandQuery("hello")).toBeNull();
  });

  it("normalizes probed command metadata and drops invalid entries", () => {
    expect(normalizeAgentAvailableCommands([
      {
        name: "  deploy  ",
        description: "Ship it",
        input: { hint: "environment" },
        kind: "workflow",
        metadata: { source: "agent" },
      },
      { name: "" },
      { name: 42 },
      null,
    ])).toEqual([
      {
        name: "deploy",
        description: "Ship it",
        input: { hint: "environment" },
        kind: "workflow",
        metadata: { source: "agent" },
      },
    ]);
  });

  it("adds the Codex plan command only when collaboration mode supports it", () => {
    expect(withSessionStateCommands(
      [{ name: "compact" }],
      [collaborationMode],
      "codex-acp",
    ).map((command) => command.name)).toEqual(["plan", "compact"]);

    expect(withSessionStateCommands(
      [{ name: "plan" }, { name: "compact" }],
      [collaborationMode],
      "codex-acp",
    ).map((command) => command.name)).toEqual(["plan", "compact"]);

    expect(withSessionStateCommands(
      [{ name: "compact" }],
      [collaborationMode],
      "claude-agent-acp",
    ).map((command) => command.name)).toEqual(["compact"]);

    // Session config is not known yet (draft / starting session): the host
    // still owns /plan for Codex, and never for other agents.
    expect(withSessionStateCommands(
      [],
      [],
      "codex-acp",
      { assumePlanCapable: true },
    ).map((command) => command.name)).toEqual(["plan"]);
    expect(withSessionStateCommands(
      [],
      [],
      "claude-acp",
      { assumePlanCapable: true },
    )).toEqual([]);
    expect(withSessionStateCommands([], [], "codex-acp")).toEqual([]);
  });

  it("treats session-state commands as local config switches, never prompts", () => {
    const [synthesized] = withSessionStateCommands(
      [],
      [collaborationMode],
      "codex-acp",
    );
    expect(slashCommandConfigAction(synthesized!)).toEqual({
      configId: "collaboration_mode",
      value: "plan",
      resetValue: "default",
    });

    // Codex publishes the same contract under `_meta.commandAction`.
    expect(slashCommandConfigAction({
      name: "plan",
      description: "Turn plan mode on.",
      _meta: {
        commandAction: {
          kind: "setConfigOption",
          configId: "collaboration_mode",
          value: "plan",
          resetValue: "default",
        },
      },
    } as never)).toEqual({
      configId: "collaboration_mode",
      value: "plan",
      resetValue: "default",
    });

    expect(slashCommandConfigAction({ name: "compact" })).toBeUndefined();
    expect(slashCommandConfigAction({
      name: "broken",
      metadata: { commandAction: { kind: "setConfigOption", configId: "" } },
    })).toBeUndefined();
    expect(slashCommandConfigAction({
      name: "other-kind",
      metadata: { commandAction: { kind: "navigate", configId: "x", value: "y" } },
    })).toBeUndefined();
  });

  it("owns /fork as a host action only when the current session can fork", () => {
    const existing = [
      { name: "fork", description: "provider fork" },
      { name: "compact" },
    ];
    const enabled = withHostForkCommand(existing, true, {
      title: "Continue in new chat",
      description: "Create a new chat with the current context",
    });

    expect(enabled.map((command) => command.name)).toEqual(["fork", "compact"]);
    expect(enabled[0]).toMatchObject({
      name: "fork",
      description: "Continue in new chat",
      kind: "host-fork",
      metadata: {
        description: "Create a new chat with the current context",
      },
    });
    expect(isHostForkSlashCommand(enabled[0]!)).toBe(true);
    expect(withHostForkCommand(existing, false, {
      title: "Continue in new chat",
      description: "Create a new chat with the current context",
    })).toEqual(existing);
  });

  it("matches prefixes, substrings, and compact abbreviations case-insensitively", () => {
    expect(matchesSlashCommand("compact", "COM")).toBe(true);
    expect(matchesSlashCommand("session-export", "export")).toBe(true);
    expect(matchesSlashCommand("session-export", "ssx")).toBe(true);
    expect(matchesSlashCommand("compact", "xyz")).toBe(false);
  });

  it("recognizes skill commands from names, metadata, and descriptions", () => {
    expect(isSkillSlashCommand({ name: "skill:review" })).toBe(true);
    expect(isSkillSlashCommand({ name: "$arrange" })).toBe(true);
    expect(isSkillSlashCommand({
      name: "review",
      metadata: { category: "skills" },
    })).toBe(true);
    expect(isSkillSlashCommand({
      name: "review",
      description: "[Skill] Review code",
    })).toBe(true);
    expect(isSkillSlashCommand({ name: "compact" })).toBe(false);
    expect(skillCommandLabel({ name: "$better-auth-best-practices" }))
      .toBe("Better-auth-best-practices");
  });

  it("keeps commands prominent and limits unfiltered skill previews", () => {
    const sections = buildSlashCommandSections([
      { name: "compact" },
      { name: "skill:one" },
      { name: "skill:two" },
      { name: "skill:three" },
    ], "", 2);

    expect(sections.map((section) => section.kind)).toEqual([
      "commands",
      "skills",
    ]);
    expect(sections[1]?.commands.map((command) => command.name)).toEqual([
      "skill:one",
      "skill:two",
    ]);
    expect(sections[1]?.hiddenCount).toBe(1);
  });

  it("formats skill command names for composer chips", () => {
    expect(skillCommandLabel({ name: "skill:review-code" })).toBe(
      "Review-code",
    );
    expect(skillCommandLabel({ name: "skill/testing" })).toBe("Testing");
  });
});

describe("codex session-state commands", () => {
  // Codex publishes the switch on `_meta`; ACP v1's AvailableCommand has no
  // such field, so every normalization hop must carry it through. Dropping it
  // is what let a draft composer send `/plan` as a prompt.
  const codexPlan = {
    name: "plan",
    description: "Turn plan mode on.",
    input: null,
    _meta: {
      commandAction: {
        kind: "setConfigOption",
        configId: "collaboration_mode",
        value: "plan",
        resetValue: "default",
        presentation: "state",
      },
    },
  };

  it("keeps _meta through normalization so the switch survives", () => {
    const [normalized] = normalizeAgentAvailableCommands([codexPlan]);

    expect(normalized._meta).toEqual(codexPlan._meta);
    expect(slashCommandConfigAction(normalized)).toEqual({
      configId: "collaboration_mode",
      value: "plan",
      resetValue: "default",
    });
  });

  it("upgrades a stripped /plan instead of leaving it sendable", () => {
    // A probe-cache round trip that lost `_meta`: same name, no action.
    const stripped = { name: "plan", description: "Turn plan mode on." };

    const [resolved] = withSessionStateCommands(
      [stripped],
      undefined,
      "codex-acp",
      { assumePlanCapable: true },
    );

    expect(resolved.name).toBe("plan");
    expect(resolved.description).toBe("Turn plan mode on.");
    expect(slashCommandConfigAction(resolved)).toMatchObject({
      configId: "collaboration_mode",
      value: "plan",
    });
  });

  it("does not duplicate or override an agent-published /plan", () => {
    const resolved = withSessionStateCommands(
      [codexPlan],
      undefined,
      "codex-acp",
      { assumePlanCapable: true },
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toBe(codexPlan);
  });

  it("leaves another harness's /plan as an ordinary prompt command", () => {
    // The official slash-command docs show a prompt-style `/plan` that takes
    // `input.hint`. Only Codex declares the config switch, so a name match
    // must never hijack anyone else.
    const promptPlan = {
      name: "plan",
      description: "Create a detailed implementation plan",
      input: { hint: "description of what to plan" },
    };

    const resolved = withSessionStateCommands(
      [promptPlan],
      undefined,
      "claude-acp",
      { assumePlanCapable: true },
    );

    expect(resolved).toEqual([promptPlan]);
    expect(slashCommandConfigAction(promptPlan)).toBeUndefined();
    expect(hostSessionStateAction(promptPlan, "claude-acp")).toBeUndefined();
  });

  it("keeps prefixPrompt commands like /goal on the prompt transport", () => {
    const codexGoal = {
      name: "goal",
      description: "Set a goal to keep pursuing.",
      input: { hint: "[<objective>|clear|pause|resume]" },
      _meta: { commandAction: { kind: "prefixPrompt", presentation: "state" } },
    };

    expect(slashCommandConfigAction(codexGoal)).toBeUndefined();
    expect(hostSessionStateAction(codexGoal, "codex-acp")).toBeUndefined();
    expect(
      withSessionStateCommands([codexGoal], undefined, "codex-acp", {
        assumePlanCapable: true,
      }),
    ).toContainEqual(codexGoal);
  });

  it("backstops a stripped /plan picked straight from the overlay", () => {
    const stripped = { name: "plan", description: "Turn plan mode on." };

    expect(hostSessionStateAction(stripped, "codex-acp")).toMatchObject({
      configId: "collaboration_mode",
      value: "plan",
    });
    expect(hostSessionStateAction(stripped, "gemini")).toBeUndefined();
  });
});
