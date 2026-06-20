import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

import { canSubmitComposer } from "./ChatView";

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
});
