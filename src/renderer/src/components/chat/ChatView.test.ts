import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

import {
  canSubmitComposer,
  shouldShowTransientThought,
} from "./ChatView";
import { folderName, isPerSessionFolderPath } from "@/lib/project-path";

describe("canSubmitComposer", () => {
  it("allows submitting text while a turn is running so it can be queued", () => {
    expect(
      canSubmitComposer({ text: "follow up", disabled: false, running: true }),
    ).toBe(true);
  });

  it("still blocks empty or disabled submits", () => {
    expect(
      canSubmitComposer({ text: "  ", disabled: false, running: true }),
    ).toBe(false);
    expect(
      canSubmitComposer({ text: "follow up", disabled: true, running: true }),
    ).toBe(false);
    expect(
      canSubmitComposer({
        text: "follow up",
        disabled: false,
        running: true,
        actionDisabled: true,
      }),
    ).toBe(false);
  });

  it("allows attachment-only prompts", () => {
    expect(
      canSubmitComposer({
        text: "  ",
        disabled: false,
        attachments: [
          {
            id: "att-1",
            name: "screenshot.png",
            path: "/tmp/screenshot.png",
            uri: "file:///tmp/screenshot.png",
            kind: "image",
            mimeType: "image/png",
            size: 10,
          },
        ],
      }),
    ).toBe(true);
  });

  it("allows annotation-only prompts", () => {
    expect(
      canSubmitComposer({
        text: "  ",
        disabled: false,
        annotations: [
          {
            id: "annotation-1",
            source_session_id: "sess-source",
            source_turn_id: "turn-source",
            text: "The selected assistant response",
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("isPerSessionFolderPath", () => {
  it("filters auto-allocated per-session folders out of project recents", () => {
    expect(
      isPerSessionFolderPath("/Users/minimax/.openma/sessions/sess-rfwr779u"),
    ).toBe(true);
    expect(
      isPerSessionFolderPath("C:\\Users\\mini\\.openma\\sessions\\sess-rfwr779u"),
    ).toBe(true);
  });

  it("keeps ordinary project folders", () => {
    expect(isPerSessionFolderPath("/Users/minimax/oos-proj/openma")).toBe(false);
    expect(isPerSessionFolderPath("/Users/minimax/projects/sessions-ui")).toBe(
      false,
    );
    expect(isPerSessionFolderPath("/Users/minimax/projects/sess-client")).toBe(
      false,
    );
  });
});

describe("folderName", () => {
  it("shows only the final folder segment for project labels", () => {
    expect(folderName("/Users/minimax/oos-proj/trade-desk")).toBe("trade-desk");
    expect(folderName("/Users/minimax/oos-proj/trade-desk/")).toBe("trade-desk");
    expect(folderName("C:\\Users\\mini\\proj\\trade-desk")).toBe("trade-desk");
  });
});

describe("shouldShowTransientThought", () => {
  it("only shows thought as a transient running status before real content arrives", () => {
    expect(
      shouldShowTransientThought({
        isStreaming: true,
        thoughtText: "Planning repository inspection",
        hasVisibleContent: false,
      }),
    ).toBe(true);
    expect(
      shouldShowTransientThought({
        isStreaming: true,
        thoughtText: "Planning repository inspection",
        hasVisibleContent: true,
      }),
    ).toBe(false);
    expect(
      shouldShowTransientThought({
        isStreaming: false,
        thoughtText: "Planning repository inspection",
        hasVisibleContent: false,
      }),
    ).toBe(false);
  });
});
