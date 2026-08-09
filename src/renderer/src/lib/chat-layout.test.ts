import { describe, expect, it } from "vitest";

import {
  CHAT_COMPOSER_FRAME_CLASS,
  CHAT_GENERATED_IMAGE_CLASS,
  CHAT_TURN_FRAME_CLASS,
} from "./chat-layout";

describe("chat layout constraints", () => {
  it("keeps turns inside the composer's rounded-corner safe line", () => {
    expect(CHAT_COMPOSER_FRAME_CLASS).toContain("max-w-3xl");
    expect(CHAT_COMPOSER_FRAME_CLASS).toContain("chat-composer-frame");
    expect(CHAT_TURN_FRAME_CLASS).toContain("max-w-3xl");
    expect(CHAT_TURN_FRAME_CLASS).toContain("chat-turn-frame");
    expect(CHAT_TURN_FRAME_CLASS).toContain("min-w-0");
    // Horizontal insets come from the shared icon-rail tokens in index.css,
    // never from per-callsite padding utilities that can drift apart.
    expect(CHAT_COMPOSER_FRAME_CLASS).not.toMatch(/\bpx-\d/);
    expect(CHAT_TURN_FRAME_CLASS).not.toMatch(/\bpx-\d/);
  });

  it("keeps generated images inside the chat column", () => {
    const classes = CHAT_GENERATED_IMAGE_CLASS.split(/\s+/);

    expect(classes).toContain("max-w-full");
    expect(classes).toContain("h-auto");
  });
});
