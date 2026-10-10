/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => undefined,
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

const seen = vi.hoisted(() => ({
  auth: [] as Array<Record<string, unknown>>,
  composer: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/chat/ComposerAuthSetup", () => ({
  ComposerAuthSetup: (props: Record<string, unknown>) => {
    seen.auth.push(props);
    return <div data-auth-open={String(props.open === true)} data-supports-logout={String(props.sessionSupportsLogout === true)} />;
  },
}));

vi.mock("@/components/chat/Composer", () => ({
  Composer: (props: Record<string, unknown>) => {
    seen.composer.push(props);
    return (
      <button type="button" data-request-auth onClick={() => (props.onRequestAuth as (() => void) | undefined)?.()}>
        composer
      </button>
    );
  },
}));

import { ChatView } from "./ChatView";
import { ProjectComposer } from "./ProjectComposer";
import { NewChatPage } from "@/pages/NewChatPage";
import { sessionStore } from "@/lib/session-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installBrowser(): void {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
  window.backchat = new Proxy({}, {
    get(_target, prop) {
      if (prop === "agentsList") return async () => [];
      if (prop === "settingsGet") return async () => null;
      if (typeof prop === "string" && prop.startsWith("on")) return () => () => undefined;
      return () => Promise.resolve(undefined);
    },
  }) as unknown as typeof window.backchat;
}

async function mount(node: ReactNode): Promise<Root> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  return root;
}

describe("auth dialog entry points", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    seen.auth = [];
    seen.composer = [];
    installBrowser();
    sessionStore.apply({
      type: "session.ready",
      session_id: "sess-open",
      acp_session_id: "acp-open",
      agent_id: "pi-acp",
      cwd: "/tmp/open",
      supports_logout: false,
    });
    sessionStore.apply({
      type: "session.ready",
      session_id: "sess-logout",
      acp_session_id: "acp-logout",
      agent_id: "pi-acp",
      cwd: "/tmp/logout",
      supports_logout: true,
    });
  });

  it("opens ChatView auth from the session requirement and the composer request", async () => {
    sessionStore.setActive("sess-open");
    const root = await mount(<ChatView />);
    expect(document.body.querySelector("[data-supports-logout]")?.getAttribute("data-supports-logout")).toBe("false");
    expect(document.body.querySelector("[data-auth-open]")?.getAttribute("data-auth-open")).toBe("false");

    sessionStore.setActive("sess-logout");
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ChatView />
        </QueryClientProvider>,
      );
    });
    expect(document.body.querySelector("[data-supports-logout]")?.getAttribute("data-supports-logout")).toBe("true");

    sessionStore.apply({
      type: "session.error",
      session_id: "sess-logout",
      message: "Authentication required",
      code: "auth_required",
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ChatView />
        </QueryClientProvider>,
      );
    });
    expect(document.body.querySelector("[data-auth-open]")?.getAttribute("data-auth-open")).toBe("true");

    sessionStore.setActive(null);
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ChatView />
        </QueryClientProvider>,
      );
    });
    await act(async () => root.unmount());
  });

  it("opens the new-chat dialog when the draft requires auth", async () => {
    const root = await mount(<NewChatPage />);
    const draftId = sessionStore.active()?.id;
    expect(draftId).toBeTruthy();
    expect(sessionStore.active()?.status).toBe("draft");
    expect(document.body.querySelector("[data-auth-open]")?.getAttribute("data-auth-open")).toBe("false");
    await act(async () => {
      sessionStore.apply({
        type: "session.error",
        session_id: draftId!,
        message: "Authentication required",
        code: "auth_required",
        auth: {
          status: "needs-auth",
          message: "Authentication required",
          supportsLogout: true,
        },
      });
    });
    expect(sessionStore.active()?.status).toBe("draft");
    expect(document.body.querySelector("[data-auth-open]")?.getAttribute("data-auth-open")).toBe("true");
    expect(document.body.querySelector("[data-supports-logout]")?.getAttribute("data-supports-logout")).toBe("true");
    const button = document.body.querySelector("[data-request-auth]");
    if (button instanceof HTMLElement) {
      await act(async () => {
        button.click();
      });
    }
    await act(async () => root.unmount());
  });

  it("opens project auth from the prop and from the live session", async () => {
    const idle = await mount(
      <ProjectComposer
        agentId="pi-acp"
        placeholder="Message"
        busy={false}
        localAuth
        onSubmit={async () => true}
        onEditAgents={() => undefined}
      />,
    );
    expect(seen.auth.at(-1)?.open).toBe(false);
    await act(async () => idle.unmount());

    const required = await mount(
      <ProjectComposer
        agentId="pi-acp"
        placeholder="Message"
        busy={false}
        localAuth
        authRequired
        onSubmit={async () => true}
        onEditAgents={() => undefined}
      />,
    );
    expect(seen.auth.at(-1)?.open).toBe(true);
    expect(seen.auth.at(-1)?.sessionSupportsLogout).toBe(false);
    await act(async () => required.unmount());

    sessionStore.apply({
      type: "session.error",
      session_id: "sess-logout",
      message: "Authentication required",
      code: "auth_required",
    });
    const live = await mount(
      <ProjectComposer
        agentId="pi-acp"
        sessionId="sess-logout"
        placeholder="Message"
        busy={false}
        localAuth
        onSubmit={async () => true}
        onEditAgents={() => undefined}
      />,
    );
    expect(seen.auth.at(-1)?.open).toBe(true);
    expect(seen.auth.at(-1)?.sessionSupportsLogout).toBe(true);
    await act(async () => live.unmount());
  });
});
