import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Turn } from "@/lib/session-store";
import { ProjectConversation } from "./ProjectConversation";

it("uses the ordinary chat surface and turn frame for coordinator history", () => {
  const turn = {
    id: "project-turn", sessionId: "coordinator-session", promptText: "Ship it",
    assistantText: "Done", thoughtText: "", status: "complete", events: [], startedAt: 1_000,
  } as Turn;
  const html = renderToStaticMarkup(
    <ProjectConversation
      turns={[turn]}
      cwd={null}
      composer={<textarea aria-label="Project message" />}
    />,
  );
  expect(html).toContain('data-chat-surface="project"');
  expect(html).toContain('data-chat-column="turns"');
  expect(html).toContain('data-session-turn-status="complete"');
  expect(html).toContain("Ship it");
  expect(html).toContain("Done");
  expect(html).toContain('aria-label="Project message"');
});
