import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UserPromptBubble } from "./UserPromptBubble";
import type { Turn } from "@/lib/session-store";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn-1",
    sessionId: "session-1",
    promptText: "",
    events: [],
    assistantText: "",
    thoughtText: "",
    status: "complete",
    startedAt: 0,
    ...overrides,
  } as Turn;
}

describe("UserPromptBubble", () => {
  it("renders a markdown link in the prompt as a link, not as its syntax", () => {
    const html = renderToStaticMarkup(
      <UserPromptBubble
        turn={makeTurn()}
        text="[#65](https://github.com/openma-ai/backchat/issues/65)"
      />,
    );

    expect(html).toContain('href="https://github.com/openma-ai/backchat/issues/65"');
    expect(html).toContain("#65");
    expect(html).not.toContain("[#65]");
    expect(html).not.toContain("](https://github.com/openma-ai/backchat/issues/65)");
  });

  it("keeps the line structure the user wrote", () => {
    const html = renderToStaticMarkup(
      <UserPromptBubble turn={makeTurn()} text={"first line\nsecond line"} />,
    );

    expect(html).toContain("whitespace-pre-wrap");
    // The bubble's own density and line handling win over the markdown
    // surface's defaults.
    expect(html).not.toContain("whitespace-normal");
    expect(html).not.toContain("space-y-4");
    expect(html).toContain("first line\nsecond line");
  });

  it("copies the raw prompt, not the rendered markdown", () => {
    const source = readFileSync(new URL("./UserPromptBubble.tsx", import.meta.url), "utf8");

    expect(source).toContain("copyText={displayText}");
    expect(source).toContain("text={displayText}");
  });
});
