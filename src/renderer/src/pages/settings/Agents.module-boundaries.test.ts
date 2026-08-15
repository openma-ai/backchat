import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("agent settings module boundaries", () => {
  it("delegates credential and custom-agent forms to dedicated panels", () => {
    const source = readFileSync(resolve(__dirname, "Agents.tsx"), "utf8");

    expect(source).toContain('from "./AgentSettingsPanels"');
    expect(source).not.toContain("function CredentialPanel(");
    expect(source).not.toContain("function CustomAgentPanel(");
  });

  it("delegates agent row presentation to its dedicated module", () => {
    const source = readFileSync(resolve(__dirname, "Agents.tsx"), "utf8");

    expect(source).toContain('from "./AgentSettingsRow"');
    expect(source).not.toContain("function AgentRow(");
    expect(source).not.toContain("function pendingActionLabel(");
  });

  it("renders the installed version next to the agent id", () => {
    const row = readFileSync(resolve(__dirname, "AgentSettingsRow.tsx"), "utf8");

    expect(row).toContain("setup.versionText");
  });

  it("keeps every advertised auth method inside one inline setup lifecycle", () => {
    const page = readFileSync(resolve(__dirname, "Agents.tsx"), "utf8");
    const row = readFileSync(resolve(__dirname, "AgentSettingsRow.tsx"), "utf8");
    const panels = readFileSync(resolve(__dirname, "AgentSettingsPanels.tsx"), "utf8");

    expect(panels).toContain("export function AgentAuthSetupPanel");
    expect(page).toContain("AgentAuthSetupPanel");
    expect(page).not.toContain("agentProbe(");
    expect(panels).not.toContain("Check now");
    expect(row).not.toContain("<select");
  });

  it("treats agent api-key vars as an ACP store form, not an env override", () => {
    const panels = readFileSync(resolve(__dirname, "AgentSettingsPanels.tsx"), "utf8");
    const composerAuth = readFileSync(
      resolve(__dirname, "../../components/chat/ComposerAuthSetup.tsx"),
      "utf8",
    );
    const page = readFileSync(resolve(__dirname, "Agents.tsx"), "utf8");

    expect(panels).toContain("ACP authenticate");
    expect(panels).toContain("local environment override");
    expect(panels).toContain("form === \"fields\"");
    expect(panels).toContain("{ values }");
    expect(panels).toContain("StatusNotice");
    expect(composerAuth).toContain("values:");
    expect(composerAuth).toContain("auth.error");
    expect(page).toContain("values:");
  });
});
