import { describe, expect, it } from "vitest";

import {
  CHAT_COMPOSER_FRAME_CLASS,
  CHAT_GENERATED_IMAGE_CLASS,
  CHAT_TURN_FRAME_CLASS,
} from "./chat-layout";

describe("chat layout constraints", () => {
  it("keeps turns inside the composer's rounded-corner safe line", () => {
    expect(CHAT_COMPOSER_FRAME_CLASS).toContain("max-w-3xl");
    expect(CHAT_COMPOSER_FRAME_CLASS).toContain("px-4");
    expect(CHAT_TURN_FRAME_CLASS).toContain("max-w-3xl");
    expect(CHAT_TURN_FRAME_CLASS).toContain("px-8");
    expect(CHAT_TURN_FRAME_CLASS).toContain("min-w-0");
    expect(CHAT_TURN_FRAME_CLASS).not.toContain("px-3");
  });

  it("keeps generated images inside the chat column", () => {
    const classes = CHAT_GENERATED_IMAGE_CLASS.split(/\s+/);

    expect(classes).toContain("max-w-full");
    expect(classes).toContain("h-auto");
  });
});
