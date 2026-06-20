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
    const chatSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/chat/ChatView.tsx",
      ),
      "utf-8",
    );

    expect(pairSource).toContain("Composer");
    expect(pairSource).toContain("CHAT_COMPOSER_FRAME_CLASS");
    expect(pairSource).toContain("agentPickerAgentIds");
    expect(chatSource).toContain("agentPickerAgentIds");
    expect(chatSource).not.toContain("UsersIcon");
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

  it("renders logo-only pair marks in the app shell header, not the transcript", () => {
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

    expect(shellSource).toContain("PairTopbar");
    expect(topbarSource).toContain("export function PairTopbar");
    expect(topbarSource).toContain("AgentIcon");
    expect(topbarSource).toContain("agentId={m.agent_id}");
    expect(topbarSource).toContain("border-l border-border/60");
    expect(pairSource).not.toContain("AgentIcon");
    expect(pairSource).not.toContain("h-10 shrink-0");
    expect(pairSource).not.toContain("session.agent_id}</span>");
    expect(pairSource).not.toContain("border-b border-border/60 px-4 text-xs");
  });
});
