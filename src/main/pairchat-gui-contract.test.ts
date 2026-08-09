import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PairChatView composer", () => {
  it("uses the shared ChatView composer instead of a bespoke textarea", () => {
    const pairSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/chat/PairChatView.tsx",
      ),
      "utf-8",
    );
    const composerSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/chat/Composer.tsx",
      ),
      "utf-8",
    );

    expect(pairSource).toContain("Composer");
    expect(pairSource).toContain("CHAT_COMPOSER_FRAME_CLASS");
    expect(pairSource).toContain("agentPickerAgentIds");
    expect(composerSource).toContain("agentPickerAgentIds");
    expect(composerSource).not.toContain("UsersIcon");
    expect(pairSource).not.toContain("@/components/ui/textarea");
    expect(pairSource).not.toContain("@/components/ui/button");
  });

  it("keeps the pair transcript as a split view instead of rounded cards", () => {
    const pairSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/chat/PairChatView.tsx",
      ),
      "utf-8",
    );

    expect(pairSource).toContain("border-l border-border/60");
    expect(pairSource).not.toContain("rounded-lg border");
    expect(pairSource).not.toContain("bg-bg/40");
  });

  it("keeps each pair logo and transcript inside one continuously divided column", () => {
    const pairSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/chat/PairChatView.tsx",
      ),
      "utf-8",
    );
    const shellSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/ShellLayout.tsx",
      ),
      "utf-8",
    );
    const topbarSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/Topbar.tsx",
      ),
      "utf-8",
    );

    expect(shellSource).not.toContain("<PairTopbar />");
    expect(topbarSource).not.toContain("export function PairTopbar");
    expect(pairSource).toContain("AgentIcon");
    expect(pairSource).toContain("agentId={session.agent_id}");
    expect(pairSource).toContain('data-pair-column-header="true"');
    expect(pairSource).toContain("border-l border-border/60");
  });
});
