import { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/settings/appearance" }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    className,
    children,
  }: {
    className?: string;
    children?: React.ReactNode;
  }) => <a className={className}>{children}</a>,
  useLocation: () => ({ pathname: route.pathname }),
  useNavigate: () => () => undefined,
  Outlet: () => null,
}));

vi.mock("@/lib/projects-query", () => ({
  useProjects: () => ({
    data: [
      {
        id: "proj-1",
        name: "Font",
        source_folders: [],
        primary_folder: "/tmp/font",
      },
      {
        id: "proj-2",
        name: "Other",
        source_folders: [],
        primary_folder: "/tmp/other",
      },
    ],
  }),
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: () => <span data-project-icon="true" />,
}));

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

const appearance = {
  theme: "system" as const,
  language: "system" as const,
  light_theme_id: "backchat-light",
  dark_theme_id: "backchat-dark",
  font_size: "md" as const,
  density: "default" as const,
};

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => ({
    appearance,
    agents: [],
    default: { permission_mode: "ask", workspace_path: "", prompt_queue_enabled: true },
  }),
  patchSettings: () => undefined,
  getSettings: () => ({
    appearance,
    agents: [],
    default: { permission_mode: "ask", workspace_path: "", prompt_queue_enabled: true },
  }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    effective: "light",
    theme: "system",
    themeId: "backchat-light",
    lightThemeId: "backchat-light",
    darkThemeId: "backchat-dark",
    setTheme: () => undefined,
  }),
}));

import { AnnotationBadge } from "./chat/AnnotationEditor";
import { Composer } from "./chat/Composer";
import { ComposerBrokerAsk } from "./chat/ComposerAskPanel";
import { SuggestionTemplateEditor } from "./chat/ComposerContentParts";
import { ElicitationAskForm } from "./chat/ElicitationAskForm";
import { PlanDocumentActivity } from "./chat/PlanDocumentActivity";
import { ComposerAction, ComposerInput } from "./chat/ComposerPrimitives";
import { ToolActivityIdentity } from "./chat/ToolActivityPrimitives";
import { MessageContent } from "./ai-elements/message";
import { Button } from "./ui/button";
import { InputGroup } from "./ui/input-group";
import { Label } from "./ui/label";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { SettingsAppearance } from "../pages/settings/Appearance";
import { SettingsSidebar } from "../pages/settings/SettingsLayout";

describe("changed type surfaces", () => {
  it("renders the shared text roles on the small controls", () => {
    expect(renderToStaticMarkup(<Button>Send</Button>)).toContain("disabled:text-fg-disabled");
    expect(renderToStaticMarkup(<Label>Name</Label>)).toContain("text-fg-disabled");
    expect(renderToStaticMarkup(<InputGroup />)).toContain("has-disabled:bg-input/50");
    expect(renderToStaticMarkup(<InputGroup />)).not.toContain("has-disabled:opacity-50");
    expect(renderToStaticMarkup(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )).toContain("text-fg-muted");
    expect(renderToStaticMarkup(<MessageContent>Hello</MessageContent>)).toContain("text-body");
    expect(renderToStaticMarkup(<AnnotationBadge index={2} />)).toContain("text-white");
    expect(renderToStaticMarkup(
      <ComposerInput rows={2} placeholder="Ask" />,
    )).toContain("placeholder:text-fg-subtle");
    expect(renderToStaticMarkup(
      <ComposerAction type="button">Go</ComposerAction>,
    )).toContain("disabled:text-fg-disabled");
  });

  it("renders plan, tool, and elicitation copy in the subtle role", () => {
    expect(renderToStaticMarkup(
      <PlanDocumentActivity
        document={{ title: null } as never}
        cwd={null}
        sessionId="s"
      />,
    )).toContain("text-fg-subtle");
    expect(renderToStaticMarkup(
      <ToolActivityIdentity label="Read" target="index.css" />,
    )).toContain("text-fg-subtle");
    const form = renderToStaticMarkup(
      <ElicitationAskForm
        ask={{
          requestId: "ask-1",
          sessionId: "s",
          message: "Choose",
          fields: [
            {
              name: "kind",
              title: "Kind",
              required: true,
              type: "select",
              options: [{ value: "a", label: "A" }],
            },
            {
              name: "kind__other",
              title: "Other",
              required: false,
              type: "text",
            },
          ],
        }}
        onSubmit={() => undefined}
      />,
    );
    expect(form).toContain("disabled:text-fg-disabled");
    expect(renderToStaticMarkup(
      <ComposerBrokerAsk
        ask={{
          kind: "permission",
          ask: {
            requestId: "p1",
            sessionId: "s",
            toolCall: { title: "bash" },
            presentation: { title: "bash", kind: "execute", command: "true" },
            options: [
              { optionId: "once", name: "Allow", kind: "allow_once" },
              { optionId: "no", name: "Reject", kind: "reject_once" },
            ],
          },
        }}
        onResolve={() => undefined}
      />,
    )).toContain("bg-fg text-bg");
  });

  it("renders the composer attach control with the disabled text role", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <Composer
          sessionId="coverage-local"
          disabled={false}
          running={false}
          placeholder="Ask"
          lockedAgentId={null}
          pickedAgentId={null}
          onPickAgent={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain("disabled:text-fg-disabled");
  });

  it("renders selected and resting settings rows", () => {
    const sidebar = renderToStaticMarkup(<SettingsSidebar />);
    route.pathname = "/settings/projects/proj-1";
    const selectedProject = renderToStaticMarkup(<SettingsSidebar />);
    route.pathname = "/settings/appearance";
    expect(sidebar).toContain("font-semibold text-fg");
    expect(sidebar).toContain("font-normal text-fg-muted");
    expect(selectedProject).toContain("font-semibold text-fg");
    expect(sidebar).not.toContain("font-medium text-fg\"");
    const appearanceHtml = renderToStaticMarkup(<SettingsAppearance />);
    expect(appearanceHtml).toContain("font-semibold text-fg");
    expect(appearanceHtml).toContain("whitespace-nowrap");
    expect(appearanceHtml).toContain("max-w-full");
    expect(renderToStaticMarkup(
      <SuggestionTemplateEditor
        inputRef={createRef()}
        template={{ before: "Shape ", slotLabel: "idea", after: "" }}
        value=""
        disabled={false}
        onChange={() => undefined}
        onRemove={() => undefined}
        onSubmit={() => undefined}
      />,
    )).toContain("text-body");
  });
});
