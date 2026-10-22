import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "chat.signIn": "Sign in",
      "auth.switchAccount": "Switch account",
    })[key] ?? key,
  }),
}));

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={() => onSelect?.()}>{children}</button>
  ),
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({
    children,
    ...props
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>{children}</button>
  ),
}));

import { SessionRunChip } from "./ComposerSessionControls";

const agent = {
  id: "pi-acp",
  label: "pi",
  command: "pi-acp",
  detected: true,
};

describe("harness auth menu", () => {
  it("opens sign-in while authentication is required", () => {
    let opened = 0;
    const html = renderToStaticMarkup(
      <SessionRunChip
        disabled={false}
        locked={false}
        authNeeded
        supportsLogout
        onOpenAuth={() => { opened += 1; }}
        agents={[agent]}
        currentAgentId="pi-acp"
        onPickAgent={() => undefined}
        onSetConfigOption={() => undefined}
      />,
    );
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Switch account");
    expect(opened).toBe(0);
  });

  it("offers switch account only after the harness is signed in", () => {
    const signedIn = renderToStaticMarkup(
      <SessionRunChip
        disabled={false}
        locked={false}
        supportsLogout
        onOpenAuth={() => undefined}
        agents={[agent]}
        currentAgentId="pi-acp"
        onPickAgent={() => undefined}
        onSetConfigOption={() => undefined}
      />,
    );
    const hidden = renderToStaticMarkup(
      <SessionRunChip
        disabled={false}
        locked={false}
        onOpenAuth={() => undefined}
        agents={[]}
        currentAgentId="pi-acp"
        onPickAgent={() => undefined}
        onSetConfigOption={() => undefined}
      />,
    );
    expect(signedIn).toContain("Switch account");
    expect(hidden).not.toContain("Switch account");
    expect(hidden).not.toContain("Sign in");
  });
});
