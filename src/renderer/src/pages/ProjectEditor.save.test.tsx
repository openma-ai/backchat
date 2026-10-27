/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: () => null,
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/settings-store", () => ({ useSettings: () => ({}) }));
vi.mock("@/lib/enabled-agents", () => ({ enabledAgentIds: () => new Set(), isAgentRunnable: () => true }));
vi.mock("@/lib/projects-query", () => ({ useProjects: () => ({ data: [] }) }));
vi.mock("@/components/chat/ChatView", () => ({ ChatView: () => null }));
vi.mock("@/components/chat/ProjectComposer", () => ({ ProjectComposer: () => null }));
vi.mock("@/components/chat/ChatMarkdown", () => ({ StreamdownText: () => null }));
vi.mock("@/components/chat/ProjectMessageAttachments", () => ({ ProjectMessageAttachments: () => null }));
vi.mock("@/lib/session-store", () => ({ sessionStore: {} }));
vi.mock("@/components/AgentIcon", () => ({ AgentIcon: () => null }));
vi.mock("@/lib/history-paging", () => ({ openHistoryWindow: vi.fn() }));

import { ProjectEditor } from "./Projects";

describe("ProjectEditor save", () => {
  let root: Root;
  let container: HTMLDivElement;
  const projectSave = vi.fn();
  const projectWorkSave = vi.fn();
  const saved = vi.fn();

  beforeEach(() => {
    projectSave.mockReset().mockResolvedValue({ id: "proj-existing" });
    projectWorkSave.mockReset().mockResolvedValue(undefined);
    saved.mockReset().mockResolvedValue(undefined);
    Object.assign(window, { backchat: { projectSave, projectWorkSave } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("stores the work config under the project the registry resolved", async () => {
    act(() => root.render(
      <ProjectEditor removed={async () => undefined} close={() => undefined} saved={saved} />,
    ));
    const input = document.querySelector<HTMLInputElement>("input[required]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "hilo-coord-test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (input.closest("form") ?? document.querySelector("form"))!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(saved).toHaveBeenCalled());
    });

    const fresh = projectSave.mock.calls[0]![0].project_id;
    expect(fresh).toMatch(/^proj-/);
    expect(fresh).not.toBe("proj-existing");
    expect(projectWorkSave).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj-existing" }));
    expect(saved).toHaveBeenCalledWith("proj-existing");
  });
});
