import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => undefined,
}));

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
  }),
}));

import { ChatView } from "./ChatView";
import { sessionStore } from "@/lib/session-store";

function shell(node: ReactNode) {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

describe("coordinator chat uses the normal chat path", () => {
  beforeAll(() => {
    const backchat = {
      agentsList: async () => [],
      settingsGet: async () => null,
      onSettingsChanged: () => () => undefined,
      sessionsLoadHistory: async () => [],
    };
    const documentMock = {
      documentElement: {
        dataset: {},
        style: { setProperty() {} },
        classList: { toggle() {} },
        lang: "en",
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const storage = { getItem: () => null, setItem() {}, removeItem() {} };
    Object.assign(globalThis, {
      document: documentMock,
      localStorage: storage,
      window: {
        backchat,
        document: documentMock,
        localStorage: undefined,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      },
    });
    sessionStore.ensureBoundSession({
      id: "normal-session",
      agentId: "codex-acp",
      cwd: "/tmp/normal",
      label: "Normal",
    });
    sessionStore.registerTurn("normal-turn", "normal-session", "Hello from a normal chat");
    sessionStore.ensureBoundSession({
      id: "coordinator-session",
      agentId: "codex-acp",
      cwd: "/tmp/project",
      label: "Coordinator",
      projectId: "project-1",
    });
    sessionStore.registerTurn("coordinator-turn", "coordinator-session", "Hello from the coordinator");
  });

  it("renders both transcripts through ChatView", () => {
    sessionStore.setActive("normal-session");
    const normal = shell(<ChatView />);
    const coordinator = shell(
      <ChatView
        binding={{
          projectId: "project-1",
          sessionId: "coordinator-session",
          agentId: "codex-acp",
          cwd: "/tmp/project",
          label: "Coordinator",
          placeholder: "Message coordinator…",
          inputLabel: "Message coordinator",
          loadHistory: false,
          deliver: async () => undefined,
        }}
      />,
    );

    for (const html of [normal, coordinator]) {
      expect(html).toContain('data-chat-surface="main"');
      expect(html).toContain('data-chat-column="composer"');
      expect(html).toContain('data-chat-column="turns"');
      expect(html).toContain("data-session-turn-prompt");
      expect(html).toContain("data-user-echo-status=\"pending\"");
      expect(
        html.includes('data-composer-submit="true"')
        || html.includes('data-composer-stop="true"'),
      ).toBe(true);
    }
    expect(normal).toContain("Hello from a normal chat");
    expect(coordinator).toContain("Hello from the coordinator");
    expect(coordinator).toContain('data-chat-binding="coordinator"');
    expect(coordinator).toContain('aria-label="Message coordinator"');
    expect(normal).not.toContain("ProjectComposer");
    expect(coordinator).not.toContain("ProjectConversation");
  });
});
