import { describe, expect, it } from "vitest";

import {
  buildSlashCommandSections,
  isSkillSlashCommand,
  matchesSlashCommand,
  normalizeAgentAvailableCommands,
  skillCommandLabel,
  slashCommandQuery,
  withSessionStateCommands,
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
  });

  it("matches prefixes, substrings, and compact abbreviations case-insensitively", () => {
    expect(matchesSlashCommand("compact", "COM")).toBe(true);
    expect(matchesSlashCommand("session-export", "export")).toBe(true);
    expect(matchesSlashCommand("session-export", "ssx")).toBe(true);
    expect(matchesSlashCommand("compact", "xyz")).toBe(false);
  });

  it("recognizes skill commands from names, metadata, and descriptions", () => {
    expect(isSkillSlashCommand({ name: "skill:review" })).toBe(true);
    expect(isSkillSlashCommand({
      name: "review",
      metadata: { category: "skills" },
    })).toBe(true);
    expect(isSkillSlashCommand({
      name: "review",
      description: "[Skill] Review code",
    })).toBe(true);
    expect(isSkillSlashCommand({ name: "compact" })).toBe(false);
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
