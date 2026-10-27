import { describe, expect, it } from "vitest";

import {
  applySlashInputHint,
  resolveSlashInputHint,
} from "./composer-slash-input-hint";
import type { AcpAvailableCommand } from "./session-store";

const review: AcpAvailableCommand = {
  name: "review",
  description: "Review the current changes.",
  input: { hint: "optional review instructions" },
};
const reviewBranch: AcpAvailableCommand = {
  name: "review-branch",
  description: "Review a branch.",
  input: { hint: "branch name" },
};
const goal: AcpAvailableCommand = {
  name: "goal",
  description: "Set a goal to keep pursuing.",
  input: { hint: "[<objective>|clear|pause|resume]" },
  _meta: { commandAction: { kind: "prefixPrompt", presentation: "state" } },
};
const adapt: AcpAvailableCommand = {
  name: "adapt",
  description: "Adapt the app.",
  input: { hint: "[target] [context (mobile, tablet, print...)]" },
};
const compact: AcpAvailableCommand = {
  name: "compact",
  description: "Compress this conversation.",
};
const plan: AcpAvailableCommand = {
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
};

const commands = [review, reviewBranch, goal, adapt, compact, plan];

describe("resolving a slash command's input hint", () => {
  it("resolves the hint for a bare command", () => {
    expect(resolveSlashInputHint({ text: "/review", commands })).toEqual({
      commandName: "review",
      hint: "optional review instructions",
      prefix: "/review",
    });
  });

  it("resolves the hint for a bare command with a trailing space", () => {
    expect(resolveSlashInputHint({ text: "/review ", commands })).toEqual({
      commandName: "review",
      hint: "optional review instructions",
      prefix: "/review",
    });
  });

  it("resolves hints from any harness that publishes one", () => {
    // Codex and Claude spell their hints differently; the composer reads
    // whatever the agent declared.
    expect(resolveSlashInputHint({ text: "/review-branch", commands }))
      .toMatchObject({ hint: "branch name" });
    expect(resolveSlashInputHint({ text: "/goal", commands }))
      .toMatchObject({ hint: "[<objective>|clear|pause|resume]" });
    expect(resolveSlashInputHint({ text: "/adapt", commands }))
      .toMatchObject({ hint: "[target] [context (mobile, tablet, print...)]" });
  });

  it("has no hint once the user started the argument", () => {
    expect(resolveSlashInputHint({ text: "/review focus on tests", commands }))
      .toBeNull();
    expect(resolveSlashInputHint({ text: "/review x", commands })).toBeNull();
  });

  it("has no hint for a command that declares none", () => {
    expect(resolveSlashInputHint({ text: "/compact", commands })).toBeNull();
    expect(resolveSlashInputHint({
      text: "/compact",
      commands: [{ name: "compact", input: { hint: "  " } }],
    })).toBeNull();
  });

  it("has no hint for an unknown command or plain text", () => {
    expect(resolveSlashInputHint({ text: "/unknown", commands })).toBeNull();
    expect(resolveSlashInputHint({ text: "review", commands })).toBeNull();
    expect(resolveSlashInputHint({ text: "", commands })).toBeNull();
    expect(resolveSlashInputHint({ text: "/", commands })).toBeNull();
  });

  it("matches the catalogue spelling exactly", () => {
    expect(resolveSlashInputHint({ text: "/Review", commands })).toBeNull();
    expect(resolveSlashInputHint({ text: "/review-branch", commands }))
      .toMatchObject({ commandName: "review-branch" });
  });

  it("never offers the hint of a session-state switch", () => {
    // `/plan` is a local config switch: it is complete without an argument.
    expect(resolveSlashInputHint({
      text: "/plan",
      commands: [{ ...plan, input: { hint: "mode" } }],
    })).toBeNull();
  });

  it("is empty once the ghost has been dismissed", () => {
    expect(resolveSlashInputHint({
      text: "/review",
      commands,
      dismissed: true,
    })).toBeNull();
  });
});

describe("applying a slash command's input hint", () => {
  // Tab (picker closed) and right-click on a visible ghost both call
  // applySlashInputHint — keep that helper the single insert/select path.

  it("completes the command with exactly one space", () => {
    expect(applySlashInputHint("/review", "optional review instructions")).toEqual({
      text: "/review optional review instructions",
      selectionStart: 8,
      selectionEnd: 36,
    });
  });

  it("collapses the space the user already typed", () => {
    expect(applySlashInputHint("/review ", "optional review instructions"))
      .toEqual(applySlashInputHint("/review", "optional review instructions"));
    expect(applySlashInputHint("/review   ", "optional review instructions"))
      .toEqual(applySlashInputHint("/review", "optional review instructions"));
  });

  it("selects the inserted hint so the user can type over it", () => {
    const applied = applySlashInputHint("/review", "optional review instructions");
    expect(applied.text.slice(applied.selectionStart, applied.selectionEnd))
      .toBe("optional review instructions");
  });

  it("is the shared apply path for Tab and right-click", () => {
    // Both Composer affordances must produce the same insert + selection.
    const viaTab = applySlashInputHint("/review ", "optional review instructions");
    const viaRightClick = applySlashInputHint("/review ", "optional review instructions");
    expect(viaTab).toEqual(viaRightClick);
    expect(viaTab.text).toBe("/review optional review instructions");
  });
});
